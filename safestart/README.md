# SafeStart

Parental controls made simple. A free tool from TrustRaise.

Three questions — how old is your child, what are they using, which app — and you get the
exact taps in the right order, tailored to their age.

## What changed in this rebuild

The old build kept all guide content inside JavaScript string literals, which is what
caused the repeated syntax errors around apostrophes and nested quotes. That whole class of
bug is gone:

- All guide content now lives in `guides.json`.
- The front end inserts that content with `textContent`, never as raw HTML.
- `npm run check` validates the JSON structure before you ever open a browser.

Adding a new guide is now editing JSON, not fighting escapes.

## What phase one added

Three things, on top of the original build.

**Every guide has its own URL.** `scripts/build.js` reads `guides.json` and writes a real
HTML page per guide at `/roblox/`, `/iphone/` and so on, with the content already in the
markup, its own title and description, a canonical tag, and HowTo structured data. Before
this, all 21 pages looked like one page to a search engine and the content only existed
after JavaScript ran. There is a `sitemap.xml` and a `robots.txt` now too.

**A crisis route at `/help/`.** For the parent whose worst day has already happened. Every
reporting body, phone number and URL on those pages was checked against the organization's
own site, and where a platform's reporting route could not be verified we say so instead of
guessing. The pages are fully static and work with JavaScript switched off, because they
have to work when everything else is having a bad day. The chat also watches for a live
incident and surfaces the same route immediately, without waiting on the model.

**A country setting.** US, Canada, UK and Ireland. It picks the currency in spending advice
and the right national reporting bodies. It also fixes the old `£0 / $0` line, which was
the site quietly admitting it did not know where you were. Detection is from the browser's
own timezone, so nothing is sent anywhere, and the picker is always visible.

## How it works

Static first, on purpose. A parent in a hurry should never wait for a network round trip.

```
Parent picks Roblox
  → guides.json (already cached by the CDN)
  → guide renders instantly, no function invocation, no cost

Parent searches for something not curated
  → GET /api/guide?app=…
  → Claude searches the official docs, returns a structured guide
  → cached at Vercel's edge for 7 days, so the next parent gets it instantly and free

Parent taps "Ask SafeStart"
  → POST /api/ask
  → streaming chat, with the on-screen guide passed in as context
```

### Files

| Path | What it is |
|------|------------|
| `src/app.html` | The whole front end, as a template. No framework, no dependencies. Build fills in the per-page bits. |
| `guides.json` | The curated guide database. 17 guides, 97 steps. This is the file you'll edit most. |
| `safeguarding.json` | The crisis content behind `/help/`: reporting bodies per country, what to do first, per-platform routes. |
| `scripts/build.js` | Generates the prerendered pages, the crisis pages, `sitemap.xml` and `robots.txt`. |
| `assets/` | TrustRaise logo (color and mono white), favicons, and self-hosted Inter. |
| `api/guide.js` | Generates a guide for an app that isn't curated yet. GET, so the CDN caches it. |
| `api/ask.js` | Streaming follow-up chat. |
| `api/_lib/prompt.js` | SafeStart's system prompt. Edit here to change its voice everywhere. |
| `api/_lib/anthropic.js` | Thin wrapper over the Messages API. No SDK, so nothing to install. |
| `api/_lib/ratelimit.js` | Per-IP speed bump so one visitor can't burn your credit. |
| `scripts/dev-server.js` | Local server that runs the API handlers the same way Vercel does. |
| `scripts/check.js` | Validates guides.json and the handlers. |
| `scripts/api-test.js` | Tests the API against a fake Anthropic endpoint. Costs nothing. |
| `scripts/browser-test.js` | Headless smoke test of the real UI. |

## Deploying with GitHub Desktop and Vercel

### 1. Put it on GitHub

1. Open GitHub Desktop.
2. **File → New Repository**. Name it `safestart`. Pick a local folder.
3. Copy everything from this folder into the repository folder GitHub Desktop created.
4. Back in GitHub Desktop you'll see all the files listed as changes. Write a summary like
   "SafeStart rebuild" and click **Commit to main**.
5. Click **Publish repository**. Private is fine, Vercel can still read it.

### 2. Connect it to Vercel

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import the `safestart` repository. If you don't see it, click **Adjust GitHub App
   Permissions** and give Vercel access.
3. Framework preset: **Other**. Leave the build command and output directory **empty** in
   the dashboard. `vercel.json` sets the build command, so anything typed here overrides it
   and will break the deploy.
4. Click **Deploy**.

The site will be live in under a minute. Curated guides already work at this point. The
chat and live lookups will politely tell people they're switched off until you do step 3.

### 3. Add your API key

1. In Vercel, open the project → **Settings** → **Environment Variables**.
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from [console.anthropic.com](https://console.anthropic.com)
   - Environments: tick Production, Preview and Development
3. Click Save.
4. Go to **Deployments**, open the most recent one, and choose **Redeploy**. Environment
   variables only reach a deployment when it's built.

That's it. From now on, every commit you push in GitHub Desktop deploys automatically.

### Optional environment variables

| Name | Default | What it does |
|------|---------|--------------|
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Which model answers. Sonnet is the right balance here. |
| `MAX_WEB_SEARCHES` | `5` | How many searches Claude may run per request. Lower means cheaper and faster. |

## Running it locally

```bash
npm run dev        # builds the pages, then serves them at http://localhost:3000
```

If you edit `guides.json` or `safeguarding.json`, re-run `npm run build` to regenerate the
pages. The generated files are gitignored, so they never get committed and Vercel always
rebuilds them from source.

For the chat and live lookups locally, copy `.env.example` to `.env.local` and put your key
in it. The dev server reads it automatically.

`vercel dev` also works and is closer to production, but it needs the Vercel CLI and a
login. The included dev server needs neither.

## Testing

```bash
npm run build     # regenerate the pages after a content edit
npm run check     # validates the JSON, the template and the build output
npm test          # the above, plus API tests and a headless browser run
```

`npm run check` will also fail if a page is missing a canonical tag, if two pages share a
title, if a reporting URL is not https, or if a currency string hard-codes two symbols
again.

`api-test.js` mocks the Anthropic endpoint, so the full test suite costs nothing to run.

## Adding a curated guide

Open `guides.json` and add an entry under `guides`. Copy an existing one as a starting
point. The shape:

```json
"newapp": {
  "id": "newapp",
  "name": "New App",
  "type": "app",
  "kind": "Game",
  "blurb": "One or two sentences on where the risk actually sits.",
  "devices": ["iphone", "ipad", "android"],
  "minAge": 13,
  "lastVerified": "2026-08-20",
  "sourceConfidence": "high",
  "minutes": 10,
  "risks": ["..."],
  "beforeYouStart": ["..."],
  "steps": [
    {
      "id": "chat",
      "title": "Control who can talk to them",
      "why": "One sentence.",
      "path": "Settings → Privacy → Messages",
      "do": ["Open Settings", "Tap Privacy"],
      "recommended": { "13-15": "Friends only", "16-17": "Friends only" },
      "note": "Optional caveat.",
      "ages": ["13-15", "16-17"]
    }
  ],
  "checklist": ["..."],
  "talkAboutIt": ["..."],
  "links": [{ "label": "Official help", "url": "https://..." }]
}
```

Notes:

- `id` must match the key.
- `ages` is optional. Include it to show a step only to certain age bands.
- `recommended` is optional per step, but include it wherever the right setting changes
  with age. `check.js` warns if you miss one.
- `minAge` triggers the "this app's minimum age is 13" notice for younger bands.
- Run `npm run check` after editing. It catches unknown device ids, duplicate step ids,
  broken links and missing fields.

## Keeping guides current

Every guide carries `lastVerified` and `sourceConfidence`, and the site shows both. That's
deliberate: it's honest with parents, and it tells you which guides are going stale.

A reasonable rhythm is to re-check the eight app guides every six months, and any time a
platform announces a change. The chat already searches live, so it will often catch a
change before you do. If a parent tells you a menu has moved, that's your signal.

## Cost

Curated guides cost nothing. They're static files off the CDN.

Costs only start when someone searches for an app you haven't curated, or opens the chat.
Generated guides are cached at the edge for seven days, so the tenth parent asking about
the same app that week costs the same as the first: nothing.

The rate limiter allows 8 new-guide lookups and 25 chat messages per IP per ten minutes.

### If it gets busy

`api/_lib/ratelimit.js` keeps its counters in memory. Serverless instances are ephemeral
and several can run at once, so it's a speed bump rather than a wall. If SafeStart gets
real traffic, swap it for Vercel KV or Upstash Redis, which are shared across instances.
The interface is one function, so it's a small change.

You may also want a spend limit on the Anthropic account itself, which is the only hard
ceiling that can't be worked around.

## Brand

SafeStart runs on the TrustRaise visual system, with the parent-facing voice kept warm and
plain. TrustRaise speaks in the footer, not in the guides.

**Color.** TrustRaise Blue `#1F3FE2` and Deep Navy `#0B1B4D` on Mist `#F2F4FA` and Paper,
with Ink and Slate for type. Signal yellow `#FFD23F` appears in exactly two places: the
highlight under "sorted" in the headline, and the completed state on a safety check. That
holds the brand's rough 70 / 20 / 10 / under-1 proportions.

**A note on the icons.** Every app and device tile gets its own icon, drawn in one line
style in TrustRaise Blue, with devices in Deep Navy. They're generic symbols, not platform
logos — no trademarks reproduced, and the set stays visually coherent. If you want stronger
color-coding by category, that means extending the palette beyond the brand's blue-and-navy
rule, which is a deliberate decision rather than a CSS tweak. Say the word and it's a small
change to the `--blue-tint` / `--navy-tint` variables and the `.card-ico` rule.

**Type.** Inter, self-hosted from `assets/fonts/`. Not loaded from Google Fonts on purpose:
a child-safety site shouldn't send a parent's browser to a third party just to render text.
The site makes zero external requests. Arial is the fallback, per the brand guide.

**Logo.** `assets/trustraise-logo.png` is your supplied artwork, cropped with the white
background knocked out. `trustraise-logo-white.png` is the mono-white variation for dark
surfaces. The favicons are the shield element on Deep Navy. If you have the SVG, drop it in
and swap the `<img src>` in the header and footer — SVG is the brand's default format and
will look sharper.

**Copy.** US English and smart quotes throughout, sentence case for headings and buttons.

## Changing SafeStart's voice

`api/_lib/prompt.js` holds the system prompt, built from the SafeStart blueprint. It covers
the age profiles, the step format, the source-confidence rules, the refusal to help anyone
bypass controls, and the tone. Both endpoints share it, so editing it changes SafeStart
everywhere at once.

## A note on scope

SafeStart gives general online safety guidance, not legal advice. It never helps anyone
bypass or secretly remove parental controls, and it says so rather than being cagey about
it. Where it can't verify current instructions it says so and links to the official source
instead of guessing.
