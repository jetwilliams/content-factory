# Responsible use

This tool makes it cheap to produce videos. That is exactly why it is built around a person checking and approving
each one. Please keep it that way.

## 1. A human approves every post

- The pipeline stops at a **draft** in the publish queue. The hand-off step never approves, schedules or posts.
- `publish approve` requires a named person and an approval code bound to the exact file and caption. If either
  changes after approval, it is not posted.
- The default publisher is `dry`: nothing is sent until you choose a real publisher yourself.
- Don't wire an agent or a script to approve on its own (no scripted `approve`, no auto-approving bot). The Telegram
  example only relays a person's decision. If nobody would watch it before it goes out, it shouldn't go out.
- Dry-run drafts are placeholder content: cancel them, never approve them for a real post.

## 2. Check the facts

- Research notes cite sources; models still invent things. Open the sources and confirm each claim.
- Remove anything you can't verify. No invented numbers, quotes, studies or experts.
- When a person has checked it, set `factCheck.status` to `"checked"` and `factCheck.by` in `script.json`.
  QA warns until then.
- Corrections: if you get something wrong, correct it publicly (pinned comment, follow-up video, or delete).

## 3. Label AI content

Most platforms require or offer a label for realistic synthetic or altered media, and rules change often.
Check each platform's current policy when you post. At the time of writing:

- **YouTube**: creators must disclose realistic altered or synthetic content in YouTube Studio.
- **TikTok**: realistic AI-generated content must be labelled (there is an AI-generated content setting when posting).
- **Instagram / Facebook**: Meta applies "AI info" labels and asks creators to disclose realistic AI-generated video/audio.

If the voice is synthetic or any visuals are generated, turn the label on. QA and `handoff.json` remind you. The
Upload-Post publisher sends the platforms' AI-content flags when `publish.upload-post.aiLabel` is `true` (the default
in `config/factory.config.json`); check the result on each platform.

## 4. No impersonation, no fake news

- Don't make anyone appear to say or do something they didn't. No cloned voices or likenesses without written consent.
- Don't present generated images as real photographs of real events.
- Don't imitate news outlets, brands or public bodies (names, logos, graphics, styles that pass as theirs).
- Don't make health, legal or financial claims you can't back with authoritative sources; never give personal
  financial advice.

## 5. Respect platforms and audiences

- Follow each platform's terms, community guidelines and rules for automated posting and APIs.
- **No mass posting or spam.** No near-duplicate videos across many accounts, no engagement bait, no keyword stuffing.
  The publish stage caps hashtags at 5 and posts only what a person approved, one item at a time.
  A few good videos beat a hundred thin ones, for viewers and for your account.
- Be honest in captions. Don't promise what the video doesn't deliver.
- Credit creators where licences require it (stock, music, voices).
- Keep content suitable for its audience; follow platform rules on minors.

## 6. Spending

Paid generation is off by default, capped per run, and logged in `spend.json`. Keep the cap low while you test.
Paid posting APIs (such as Upload-Post) use quota per upload: check your plan before you turn a real publisher on.

## 7. Your responsibility

The software is provided as-is (see LICENSE). You are responsible for what you publish with it, including rights
to every asset and compliance with the laws and platform rules that apply to you.
