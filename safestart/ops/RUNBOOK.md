# SafeStart runbook

What to do when something goes wrong, and what to check before it does. Written 26 October 2026.
The README covers how to build and deploy. This covers operating it.

## What is stateful

Almost nothing, which is why recovery is simple.

- **No database.** Plans and settings live in each parent's browser. There is nothing to back up or restore on our side.
- **Feedback** arrives as email through Resend into dave@trust-raise.com. The mailbox is the record.
- **The site itself** is the GitHub repo. Generated pages are committed, and Vercel only serves files.
- **One thing cannot be rebuilt: the Android upload keystore** (`signing.keystore` in the Play package folder, plus `signing-key-info.txt` with its password). It is git-ignored on purpose. Keep a copy in a password manager and a second copy somewhere that is not this Mac. Without it the Play app cannot be updated by us, and getting Google to reset the upload key means a support request.

## Restore test

Run on 26 October 2026: a fresh clone of the repo, then `node scripts/build.js`, `check.js` and `api-test.js`. The rebuilt pages matched the committed pages exactly, every check passed, and every file the site needs at runtime was present. To repeat it:

    git clone <repo> /tmp/restore && cd /tmp/restore/safestart
    node scripts/build.js && git status --short   # should list nothing
    node scripts/check.js && node scripts/api-test.js

## Rolling back a bad deploy

1. Vercel dashboard, project `safe-start`, Deployments tab.
2. Find the last deployment that was good, open its menu, choose **Instant Rollback**. This takes effect in seconds and needs no git work.
3. Then fix forward in git. Until you do, the next push will deploy over the rollback, so say so in the commit message.

Visitors do not get stuck on the bad version. The service worker fetches pages from the network first and only uses its cache when offline. The crisis pages under /help/ always prefer the network.

## If the model API is down or the spend cap trips

The guides, the crisis pages and the plan builder do not call the API at all and keep working.

- Ask SafeStart shows: "I couldn't reach the research service just now. Try asking again in a moment, the guide on screen is still good."
- A new guide lookup through `/api/guide` returns a 502 with a similar message. Curated guides are served from `guides.json` and are unaffected.
- To switch chat off on purpose, remove `ANTHROPIC_API_KEY` in Vercel and redeploy. The site then says chat is not switched on and the guides work as normal.

The in-memory rate limiter resets whenever a serverless instance recycles, so it slows one visitor and does not stop a determined one. The spend cap in the Anthropic console is the real ceiling. Check it is set before any press goes out.

## If a key leaks

1. Create a new key in the provider's dashboard (Anthropic console, Resend, or GitHub for the repo secret) and delete the old one first if the leak is live.
2. Update the value in Vercel, Settings, Environment Variables, for Production.
3. **Redeploy.** Vercel only applies new environment values to new deployments.
4. For the weekly freshness job, update the `ANTHROPIC_API_KEY` secret in GitHub, Settings, Secrets and variables, Actions.
5. A repo scan on 26 October 2026 found no real keys in tracked files or git history. The only match was the `sk-ant-...` placeholder in `.env.example`.

## Monitoring

- **Uptime.** One free external monitor with email and phone alerts is enough for launch week. Check `/` (keyword: SafeStart), `/help/us/` and `/guides.json`. Do not point a monitor at `/api/ask`, since every check would spend money.
- **Errors.** Vercel's function logs show API failures. The handlers log `ask failed`, `feedback: resend returned` and `guide generation failed` with the upstream status.
- **Page counter.** Vercel Web Analytics. It is deliberately not on `/plan/`.

## Launch day

- Before anything goes out: spend cap set, `RESEND_API_KEY` and `ANTHROPIC_API_KEY` present in Vercel Production, one real feedback submission received in the inbox, one real Ask SafeStart answer received.
- Watch the inbox and the Vercel function logs for the first hour, then at lunch and in the evening.
- If chat misbehaves, switch it off (see above). Nothing else depends on it.
