// Upload-Post publisher (https://www.upload-post.com). One API key posts to the social accounts you
// connected to an Upload-Post "profile" in their dashboard, so you do not need your own Meta / TikTok /
// Google developer apps. API docs: https://docs.upload-post.com
//
// Flow, per platform (each platform is its own upload, so a retry only repeats the platform that failed):
//   1. A request_id (UUID) is generated and SAVED to the queue before anything is sent. The same value
//      goes out as the Idempotency-Key header.
//   2. POST /upload (multipart: the video + caption + platform options) with async_upload=true.
//   3. Poll GET /uploadposts/status until this platform's entry is completed or failed.
//   4. If the process crashes or the response is lost, the next run finds the saved request_id and
//      polls it instead of uploading again. A failed platform is re-run server side with
//      POST /uploadposts/posts/retry when possible (no second upload).
//   5. `schedule` sends scheduled_date and gets a job_id back; Upload-Post then posts at that time even if
//      your machine is asleep. `run` later confirms the result through the job_id.
//
// Field names follow the public docs at the time of writing. Providers change their APIs: run
// `node factory.mjs publish dry-run <id>` and compare with the current docs before your first live post.
// The API key is only ever sent in the Authorization header and is redacted everywhere else.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, flag, publishSettings } from '../../publish/lib/settings.mjs';
import { PublishError } from '../../publish/lib/errors.mjs';
import { youtubeTitle } from '../../publish/lib/caption.mjs';

export const DEFAULT_BASE = 'https://api.upload-post.com/api';
const CONTENT_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm' };
const RUNNING = ['pending', 'queued', 'processing', 'in_progress', 'scheduled'];
const TRANSIENT_CODES = ['rate_limit', 'rate_limited', 'platform_error', 'internal_error', 'timeout'];
const TRANSIENT_MSG = /rate.?limit|too many|timeout|timed out|temporar|try again|unavailable/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bool = (b) => (b ? 'true' : 'false');

// Keys (UPLOAD_POST_API_KEY, UPLOAD_POST_USER) come from .env. Everything else comes from
// "publish" -> "upload-post" in config/factory.config.json; an UPLOAD_POST_* variable overrides it.
export function configFromEnv(settings = publishSettings().uploadPost) {
  const c = settings || {};
  const pick = (envName, key, fallback) => get(envName, c[key] ?? fallback);
  return {
    apiKey: get('UPLOAD_POST_API_KEY'),
    user: get('UPLOAD_POST_USER'),
    base: pick('UPLOAD_POST_API_BASE', 'apiBase', DEFAULT_BASE),
    aiLabel: flag('UPLOAD_POST_AI_LABEL', c.aiLabel ?? false),
    igShareToFeed: flag('UPLOAD_POST_IG_SHARE_TO_FEED', c.igShareToFeed ?? true),
    tiktokPrivacy: pick('UPLOAD_POST_TIKTOK_PRIVACY', 'tiktokPrivacy', undefined) || undefined, // unset = the account's default
    youtubePrivacy: pick('UPLOAD_POST_YOUTUBE_PRIVACY', 'youtubePrivacy', 'public'),
    youtubeCategory: String(pick('UPLOAD_POST_YOUTUBE_CATEGORY', 'youtubeCategory', '22')), // 22 = People & Blogs
    pollEverySec: Number(pick('UPLOAD_POST_POLL_EVERY_SEC', 'pollEverySec', 10)),
    pollMaxMin: Number(pick('UPLOAD_POST_POLL_MAX_MIN', 'pollMaxMin', 10)),
    retryBaseMs: Number(pick('UPLOAD_POST_RETRY_BASE_MS', 'retryBaseMs', 2000)),
  };
}

// The multipart fields for one platform as [name, value] pairs; value is a string or { file, type }.
// Pure, so `dry-run` prints exactly what a live run sends.
export function buildFields(item, platform, cfg, { requestId, scheduledAt } = {}) {
  const f = [
    ['user', cfg.user || '<UPLOAD_POST_USER>'],
    ['platform[]', platform],
    ['video', { file: item.file, type: CONTENT_TYPES[path.extname(item.file).toLowerCase()] || 'application/octet-stream' }],
  ];
  if (platform === 'youtube') {
    f.push(
      ['title', youtubeTitle({ title: item.title, caption: item.caption, fallback: path.basename(item.file, path.extname(item.file)) })],
      ['description', item.captionText || ''],
      ...(item.tags || []).map((t) => ['tags[]', t]),
      ['categoryId', cfg.youtubeCategory],
      ['privacyStatus', cfg.youtubePrivacy],
      ['selfDeclaredMadeForKids', 'false'],
    );
    if (cfg.aiLabel) f.push(['containsSyntheticMedia', 'true']);
  } else {
    f.push(['title', item.captionText || '']);
  }
  if (platform === 'instagram') {
    f.push(['media_type', 'REELS'], ['share_to_feed', bool(cfg.igShareToFeed)]);
    if (cfg.aiLabel) f.push(['is_ai_generated', 'true']);
  }
  if (platform === 'tiktok') {
    f.push(['post_mode', 'DIRECT_POST']);
    if (cfg.tiktokPrivacy) f.push(['privacy_level', cfg.tiktokPrivacy]);
    if (cfg.aiLabel) f.push(['is_aigc', 'true']);
  }
  f.push(['async_upload', 'true']);
  if (requestId) f.push(['request_id', requestId]);
  if (scheduledAt) f.push(['scheduled_date', new Date(scheduledAt).toISOString()]);
  return f;
}

export function describeRequest(fields, cfg, requestId) {
  const lines = [`POST ${cfg.base}/upload`, '  Authorization: Apikey [REDACTED]'];
  if (requestId) lines.push(`  Idempotency-Key: ${requestId}`);
  lines.push('  multipart/form-data:');
  for (const [k, v] of fields) {
    if (typeof v === 'string') lines.push(`    ${k} = ${JSON.stringify(v)}`);
    else {
      const size = fs.existsSync(v.file) ? fs.statSync(v.file).size : 0;
      lines.push(`    ${k} = @${path.basename(v.file)} (${v.type}, ${(size / 1e6).toFixed(1)} MB)`);
    }
  }
  return lines;
}

async function toFormData(fields) {
  const form = new FormData();
  for (const [k, v] of fields) {
    if (typeof v === 'string') form.append(k, v);
    else form.append(k, await fs.openAsBlob(v.file, { type: v.type }), path.basename(v.file));
  }
  return form;
}

export function createUploadPostPublisher(overrides = {}) {
  const cfg = { ...configFromEnv(), ...overrides };
  const fetchImpl = overrides.fetch || globalThis.fetch;

  // HTTP with retries on network errors, 429 (honours Retry-After) and 5xx.
  async function request(method, p, { query, json, form, headers = {}, retries = 3, log } = {}) {
    if (!cfg.apiKey) throw new PublishError('UPLOAD_POST_API_KEY is not set');
    const url = `${cfg.base}${p}${query ? '?' + new URLSearchParams(query) : ''}`;
    const h = { Authorization: `Apikey ${cfg.apiKey}`, accept: 'application/json', ...headers };
    if (json !== undefined) h['content-type'] = 'application/json';
    const label = `upload-post ${method} ${p}`;
    for (let attempt = 1; ; attempt++) {
      let res, data;
      try {
        res = await fetchImpl(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : form });
        const text = await res.text();
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
      } catch (e) {
        if (attempt <= retries) {
          const d = cfg.retryBaseMs * 2 ** (attempt - 1);
          log?.warn(`${label}: network error (${e.code || e.message}); retry ${attempt}/${retries} in ${d / 1000}s`);
          await sleep(d);
          continue;
        }
        throw new PublishError(`${label}: network error: ${e.message}`, { transient: true });
      }
      if (res.ok && data?.success !== false) return data;
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt <= retries) {
        const ra = Number(res.headers.get('retry-after'));
        const d = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : cfg.retryBaseMs * 2 ** (attempt - 1);
        log?.warn(`${label}: HTTP ${res.status}; retry ${attempt}/${retries} in ${Math.round(d / 1000)}s`);
        await sleep(d);
        continue;
      }
      const detail = data?.message || data?.error;
      throw new PublishError(`${label}: HTTP ${res.status}${detail ? ' ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`,
        { status: res.status, body: data, transient });
    }
  }

  const getStatus = ({ requestId, jobId }, log) =>
    request('GET', '/uploadposts/status', { query: jobId ? { job_id: jobId } : { request_id: requestId }, log });

  // Polls until this platform's entry is final. completed -> result; failed -> PublishError.
  async function waitForResult(platform, r, { log, save }, first) {
    const ids = { requestId: r.requestId, jobId: r.jobId };
    const deadline = Date.now() + cfg.pollMaxMin * 60e3;
    let st = first;
    for (;;) {
      st ||= await getStatus(ids, log);
      const results = Array.isArray(st.results) ? st.results : Object.entries(st.results || {}).map(([p, x]) => ({ platform: p, ...x }));
      const e = results.find((x) => x.platform === platform);
      const done = e && (e.status === 'completed' || (e.success === true && !RUNNING.includes(e.status)));
      const failed = (e && (e.success === false || ['failed', 'retryable', 'skipped'].includes(e.status))) || (!e && st.status === 'failed');
      if (done) {
        const url = e.post_url || e.url;
        return {
          postId: String(e.platform_post_id || e.post_id || e.video_id || r.requestId || r.jobId),
          permalink: url && /^https?:/.test(url) ? url : null,
          note: `upload-post ${r.jobId ? 'job ' + r.jobId : 'request ' + r.requestId}`,
        };
      }
      if (failed) {
        const code = e?.error_code;
        const msg = e?.error || e?.error_message || st.message || 'upload failed';
        const transient = e?.status === 'retryable' || TRANSIENT_CODES.includes(code) || (!code && TRANSIENT_MSG.test(msg));
        // Keep the ids so the next attempt can ask Upload-Post to retry server side.
        r.failedRef = ids.jobId ? { job_id: ids.jobId } : { request_id: ids.requestId };
        delete r.requestId; delete r.jobId;
        save();
        throw new PublishError(`upload-post: ${platform} failed: ${msg}${code ? ` [${code}]` : ''}`, { transient });
      }
      log.info(`upload-post: ${platform} ${e?.status || st.status || 'pending'}...`);
      if (Date.now() > deadline) throw new PublishError(`upload-post: ${platform} still processing after ${cfg.pollMaxMin} min; will resume next run`, { transient: true });
      await sleep(cfg.pollEverySec * 1000);
      st = null;
    }
  }

  async function upload(item, platform, r, { log, save, scheduledAt }) {
    r.requestId ||= crypto.randomUUID();
    save();
    const fields = buildFields(item, platform, cfg, { requestId: r.requestId, scheduledAt });
    log.info(`upload-post: uploading ${path.basename(item.file)} -> ${platform}${scheduledAt ? ' (scheduled ' + scheduledAt + ')' : ''}`);
    // retries: 0 because re-sending a multipart upload could double-post; a lost response is resumed by polling.
    return request('POST', '/upload', { form: await toFormData(fields), headers: { 'Idempotency-Key': r.requestId }, retries: 0, log });
  }

  function missing() {
    return [!cfg.apiKey && 'UPLOAD_POST_API_KEY', !cfg.user && 'UPLOAD_POST_USER'].filter(Boolean);
  }

  return {
    name: 'upload-post',
    platforms: ['instagram', 'tiktok', 'youtube'],

    ready() {
      const m = missing();
      return { ok: m.length === 0, missing: m };
    },

    describe(item, platform, { scheduledAt } = {}) {
      return [
        ...describeRequest(buildFields(item, platform, cfg, { requestId: '<uuid, saved before sending>', scheduledAt }), cfg, '<same uuid>'),
        `then poll GET ${cfg.base}/uploadposts/status every ${cfg.pollEverySec}s (max ${cfg.pollMaxMin} min)`,
      ];
    },

    async publish(item, platform, r, { log, save }) {
      const m = missing();
      if (m.length) throw new PublishError(`upload-post: missing ${m.join(', ')}`);

      // 1. Resume an earlier request or a natively scheduled job.
      if (r.requestId || r.jobId) {
        let st = null;
        try { st = await getStatus({ requestId: r.requestId, jobId: r.jobId }, log); } catch (e) { if (e.status !== 404) throw e; }
        if (st) {
          log.info(`upload-post: resuming ${r.jobId ? 'job ' + r.jobId : 'request ' + r.requestId}`);
          return waitForResult(platform, r, { log, save }, st);
        }
        if (r.jobId) throw new PublishError(`upload-post: scheduled job ${r.jobId} not found (cancelled in the dashboard?)`);
        log.warn(`upload-post: request ${r.requestId} is unknown to the provider (upload never arrived); uploading with the same id`);
      }

      // 2. Server-side retry of a failed platform (no re-upload).
      if (r.failedRef) {
        try {
          const data = await request('POST', '/uploadposts/posts/retry', { json: r.failedRef, log, retries: 1 });
          if (r.failedRef.job_id) r.jobId = r.failedRef.job_id; else r.requestId = data.request_id || r.failedRef.request_id;
          delete r.failedRef;
          save();
          return waitForResult(platform, r, { log, save });
        } catch (e) {
          if (![404, 409, 400].includes(e.status)) throw e;
          log.warn(`upload-post: server-side retry not possible (${e.message}); uploading again`);
          delete r.failedRef;
          save();
        }
      }

      // 3. Fresh upload.
      const data = await upload(item, platform, r, { log, save });
      if (data.request_id && data.request_id !== r.requestId) { r.requestId = data.request_id; save(); }
      const first = data.results ? { status: 'completed', results: data.results } : undefined;
      return waitForResult(platform, r, { log, save }, first);
    },

    async schedule(item, platform, r, { log, save }) {
      const m = missing();
      if (m.length) throw new PublishError(`upload-post: missing ${m.join(', ')}`);
      if (r.jobId) return { jobId: r.jobId, note: 'already scheduled' };
      const data = await upload(item, platform, r, { log, save, scheduledAt: item.at });
      if (!data.job_id) throw new PublishError('upload-post: no job_id in the schedule response; check the dashboard before retrying');
      r.jobId = data.job_id;
      delete r.requestId;
      save();
      return { jobId: data.job_id, note: `scheduled in Upload-Post for ${data.scheduled_date || item.at}` };
    },

    async cancelScheduled(item, platform, r, { log, save }) {
      if (!r.jobId) return;
      try {
        await request('DELETE', `/uploadposts/schedule/${encodeURIComponent(r.jobId)}`, { log, retries: 1 });
      } catch (e) { if (e.status !== 404) throw e; }
      delete r.jobId;
      save();
    },

    async metrics(item, platform, r, { log }) {
      const ref = r.requestId || r.jobId;
      if (!ref) return { error: 'no Upload-Post request id recorded for this post' };
      const data = await request('GET', `/uploadposts/post-analytics/${encodeURIComponent(ref)}`, { query: { platform }, log, retries: 1 });
      return data.platforms?.[platform] || data;
    },
  };
}

export default { name: 'upload-post', paid: true, create: (overrides) => createUploadPostPublisher(overrides) };
