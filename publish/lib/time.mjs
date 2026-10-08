// Parses the --at value. Accepts: "now", "+30m", "+2h", "+1d", "2026-11-02 18:00" (local time), or any ISO string.
export function parseWhen(s, now = new Date()) {
  if (!s || s === 'now') return new Date(now);
  const rel = /^\+(\d+)([mhd])$/.exec(s);
  if (rel) {
    const mult = { m: 60e3, h: 3600e3, d: 86400e3 }[rel[2]];
    return new Date(now.getTime() + Number(rel[1]) * mult);
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(s);
  if (local) {
    const [, y, mo, d, h, mi] = local.map(Number);
    return new Date(y, mo - 1, d, h, mi);
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) throw new Error(`cannot parse time "${s}" (use now, +2h, "2026-11-02 18:00" or an ISO string)`);
  return dt;
}

export function fmtLocal(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

export function fmtBytes(n) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}
