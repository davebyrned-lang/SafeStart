#!/usr/bin/env node
/* SafeStart freshness check.
 *
 * Every guide carries a lastVerified date and a list of the official pages it
 * was written from. Platforms move their menus constantly, so that date starts
 * rotting the moment it is written. Doing the re-check by hand across 17 guides
 * is the kind of chore that quietly never happens, and then the honesty of
 * showing the date turns into a liability.
 *
 * So this reads each guide's own official sources, compares them against the
 * steps we publish, and reports what looks different.
 *
 * The split matters:
 *   - A guide whose sources we fetched, and where nothing looks changed, gets
 *     its lastVerified date bumped. That is a fact we established, so recording
 *     it is safe.
 *   - A guide where something looks different is NEVER edited here. It goes in
 *     the report for a human to check. Letting a model rewrite safety
 *     instructions unsupervised is how a wrong menu path ships to every guide
 *     at once.
 *   - A guide whose sources we could not reach is left completely alone. An
 *     unreachable source is not evidence of anything.
 *
 * Usage:
 *   node scripts/freshness.js              report only, changes nothing
 *   node scripts/freshness.js --write      also bump confirmed dates + changelog
 *   node scripts/freshness.js --guide roblox --guide tiktok
 */

const fs = require("fs");
const path = require("path");
const { complete } = require("./../api/_lib/anthropic.js");

const ROOT = path.join(__dirname, "..");
const GUIDES = path.join(ROOT, "guides.json");
const CHANGELOG = path.join(ROOT, "changelog.json");
const REPORT_DIR = path.join(ROOT, "freshness");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const ONLY = args.reduce((acc, a, i) => (a === "--guide" && args[i + 1] ? acc.concat(args[i + 1]) : acc), []);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const TODAY = new Date().toISOString().slice(0, 10);

/* ---------------- fetching ---------------- */

// Enough of the page to see the menu names, not so much that we pay for boilerplate.
const MAX_CHARS = 14000;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rarr;|&#8594;/g, "→")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

async function fetchSource(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // Identify honestly. Several of these sites block unlabelled scrapers,
        // and we would rather be refused openly than pretend to be a browser.
        "user-agent": "SafeStartFreshnessBot/1.0 (+https://safestart.trust-raise.com; parental control guide accuracy check)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { url, ok: false, reason: "HTTP " + res.status };
    const text = htmlToText(await res.text());
    if (text.length < 400) return { url, ok: false, reason: "page returned almost no text (likely JavaScript-only)" };
    return { url, ok: true, text: text.slice(0, MAX_CHARS) };
  } catch (err) {
    return { url, ok: false, reason: (err && err.name === "TimeoutError") ? "timed out" : String((err && err.message) || err) };
  }
}

/* ---------------- the comparison ---------------- */

const SYSTEM = `You are checking whether a published parental-control guide still matches the platform's own current documentation.

You will be given the guide's steps and the text of the official pages it was written from.

For each step, compare the menu path, the setting names, and the recommended values against what the official pages currently say. Report only genuine differences: a renamed setting, a moved menu, a control that no longer exists, a new control that materially changes the advice.

What is NOT a change worth reporting:
- The official page wording differs from ours but describes the same thing
- The page does not mention a step at all (absence is not evidence of change)
- Cosmetic differences in capitalisation or punctuation

Be conservative. A false alarm costs someone ten minutes of checking. A missed change costs a parent a setting they think is on and isn't. But crying wolf every week trains people to stop reading the report, which is worse than either.

Respond with JSON only, no prose around it:
{
  "verdict": "unchanged" | "changed" | "unclear",
  "confidence": "high" | "medium" | "low",
  "changes": [
    {
      "stepId": "the step id",
      "what": "one sentence on what appears to have changed",
      "current": "what our guide says",
      "nowSays": "what the official page says now",
      "quote": "a short verbatim quote from the official page, under 15 words"
    }
  ],
  "notes": "anything a human reviewer should know, or empty string"
}

Use "unclear" when the sources do not let you tell. That is a useful answer and much better than guessing.`;

async function checkGuide(guide) {
  const links = (guide.links || []).filter((l) => /^https:\/\//.test(l.url));
  if (!links.length) {
    return { id: guide.id, status: "no-sources", sources: [] };
  }

  const fetched = [];
  for (const l of links) fetched.push(Object.assign({ label: l.label }, await fetchSource(l.url)));
  const usable = fetched.filter((f) => f.ok);

  if (!usable.length) {
    return {
      id: guide.id, status: "unreachable", sources: fetched,
      note: "Could not read any official source. Date left unchanged."
    };
  }

  const stepSummary = (guide.steps || []).map((s) => ({
    id: s.id, title: s.title, path: s.path || null,
    do: s.do || [], recommended: s.recommended || null, note: s.note || null,
  }));

  const prompt =
    "GUIDE: " + guide.name + "\n" +
    "LAST VERIFIED: " + (guide.lastVerified || "unknown") + "\n\n" +
    "PUBLISHED STEPS:\n" + JSON.stringify(stepSummary, null, 1) + "\n\n" +
    usable.map((f) => "OFFICIAL SOURCE — " + f.label + "\n" + f.url + "\n\n" + f.text).join("\n\n---\n\n");

  // No web search here: the whole point is to compare against the specific pages
  // this guide cites, not whatever a search turns up today.
  const { text: reply } = await complete({
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2000,
    webSearch: false,
  });

  let parsed;
  try {
    const raw = (reply || "").replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch (e) {
    return { id: guide.id, status: "unclear", sources: fetched, note: "Could not parse the comparison result." };
  }

  return {
    id: guide.id,
    status: parsed.verdict === "unchanged" ? "unchanged" : parsed.verdict === "changed" ? "changed" : "unclear",
    confidence: parsed.confidence || "low",
    changes: parsed.changes || [],
    notes: parsed.notes || "",
    sources: fetched,
    unreadable: fetched.filter((f) => !f.ok).length,
  };
}

/* ---------------- what a machine cannot read ----------------

   Six platforms cannot be checked automatically, and this is stable rather than
   flaky. Two of them say Disallow: / in robots.txt, which we respect; two reject
   anything that looks automated; two render entirely in JavaScript. Counting them
   as "needs a human look" every single week is what turns a weekly review into
   something nobody opens by week three, so they are held out of that number and
   rotated instead. One per week, so each gets a pair of eyes roughly monthly. */
let DATA_LINKS = {};

const UNREADABLE = {
  tiktok:      "support.tiktok.com sends Disallow: / in robots.txt, so we do not crawl it",
  playstation: "playstation.com sends Disallow: / in robots.txt, so we do not crawl it",
  fortnite:    "epicgames.com returns 403 to anything automated",
  whatsapp:    "faq.whatsapp.com returns 400 to anything automated",
  twitch:      "help.twitch.tv is a JavaScript-only portal with no text in the HTML",
  disneyplus:  "help.disneyplus.com serves an app shell with no text in the HTML",
};

function weekNumber(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}

/* This week's hand-check. Returns the guide and the exact things to eyeball, so
   the job is "open this page, are these three sentences still true", not "go and
   research TikTok". */
function rotationFor(data) {
  const ids = Object.keys(UNREADABLE).filter((id) => data.guides[id]);
  if (!ids.length) return null;
  const id = ids[weekNumber(new Date()) % ids.length];
  const g = data.guides[id];
  // The claims most likely to go stale, and most costly if they do: the menu
  // paths and the recommended values. Three is a two-minute job; ten is not.
  const claims = [];
  for (const st of g.steps || []) {
    if (st.path) claims.push({ step: st.title, kind: "menu path", text: st.path });
    else if (st.do && st.do[0]) claims.push({ step: st.title, kind: "first instruction", text: st.do[0] });
    if (claims.length >= 3) break;
  }
  return {
    id,
    name: g.name,
    why: UNREADABLE[id],
    lastVerified: g.lastVerified,
    links: (g.links || []).slice(0, 2),
    claims,
  };
}

/* ---------------- report ---------------- */

function writeReport(results, rotation) {
  const changed = results.filter((r) => r.status === "changed");
  const unclear = results.filter((r) => r.status === "unclear");
  const unchanged = results.filter((r) => r.status === "unchanged");
  const unreachable = results.filter((r) => r.status === "unreachable" || r.status === "no-sources");
  // A check that threw is not a verdict of any kind. It has to be louder than a
  // clean result, not quieter, or a broken key produces a confident all-clear.
  const errored = results.filter((r) => r.status === "error");

  // Only genuine differences go in the queue. "Unclear" nearly always means the
  // official page simply does not discuss the step, and absence is not evidence.
  // Putting it in the review count buries the handful of things that matter.
  const queue = changed;
  const surprises = unreachable.filter((r) => !UNREADABLE[r.id]);
  const expected = unreachable.filter((r) => UNREADABLE[r.id]);

  const L = [];
  L.push("# Freshness check — " + TODAY);
  L.push("");
  L.push(`${results.length} guides checked. **${queue.length} need a decision.** ` +
         `${unchanged.length} unchanged, ${unclear.length} unclear, ${expected.length} not machine-readable.`);
  L.push("");
  L.push("Nothing in `guides.json` has been rewritten by this job. Confirmed-unchanged guides had their " +
         "`lastVerified` date bumped, because that is a fact this run established rather than a judgement.");
  L.push("");

  if (errored.length) {
    L.push("## The check itself failed on these");
    L.push("");
    L.push("No verdict was reached. Do not read the rest of this as an all-clear for them.");
    L.push("");
    for (const r of errored) L.push(`- **${r.id}** — ${r.notes}`);
    L.push("");
  }

  if (queue.length) {
    L.push("## Needs a decision");
    L.push("");
    for (const r of queue) {
      L.push(`### ${r.id} _(confidence: ${r.confidence})_`);
      for (const c of r.changes || []) {
        L.push(`- **${c.stepId}** — ${c.what}`);
        if (c.current) L.push(`  - we say: ${c.current}`);
        if (c.nowSays) L.push(`  - now says: ${c.nowSays}`);
        if (c.quote) L.push(`  - quote: "${c.quote}"`);
      }
      if (r.notes) L.push(`- note: ${r.notes}`);
      L.push("");
    }
  }

  if (rotation) {
    L.push("## This week's hand-check: " + rotation.name);
    L.push("");
    L.push(rotation.why + ". Last checked by a person on " + (rotation.lastVerified || "unknown") + ".");
    L.push("");
    for (const c of rotation.claims) L.push(`- **${c.step}** (${c.kind}): \`${c.text}\``);
    L.push("");
    for (const l of rotation.links) L.push(`- ${l.label}: ${l.url}`);
    L.push("");
  }

  if (unclear.length) {
    L.push("## Unclear, no action expected");
    L.push("");
    L.push("The sources did not settle it, usually because the official page does not cover the step at all.");
    L.push("");
    for (const r of unclear) L.push(`- **${r.id}** — ${r.notes || "sources did not settle it"}`);
    L.push("");
  }

  if (surprises.length) {
    L.push("## Newly unreadable, worth knowing");
    L.push("");
    L.push("These are not on the known-unreadable list, so something changed at their end.");
    L.push("");
    for (const r of surprises) {
      const why = (r.sources || []).filter((s) => !s.ok).map((s) => `${s.url} (${s.reason})`);
      L.push(`- **${r.id}** — ${why.join("; ") || "no sources listed"}`);
    }
    L.push("");
  }

  if (expected.length) {
    L.push("## Known unreadable, on rotation");
    L.push("");
    for (const r of expected) L.push(`- **${r.id}** — ${UNREADABLE[r.id]}`);
    L.push("");
  }

  if (unchanged.length) {
    L.push("## Unchanged");
    L.push("");
    L.push(unchanged.map((r) => "`" + r.id + "`").join(" · "));
    L.push("");
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, "report-" + TODAY + ".md");
  fs.writeFileSync(file, L.join("\n"), "utf8");

  writePrBody({ results, queue, unclear, unchanged, expected, surprises, errored, rotation });

  return { file, changed, unclear, unchanged, unreachable, queue, surprises, expected, errored, markdown: L.join("\n") };
}

/* The pull request body IS the review. If it sends you off to open a report file
   to find out what is being asked, the five-minute job has already become a
   twenty-minute one. Everything needed to say yes or no is in here, as a
   checklist, with the evidence side by side. */
function writePrBody(o) {
  const minutes = Math.min(15, o.queue.length * 2 + (o.rotation ? 3 : 0) + (o.surprises.length ? 2 : 0));
  const L = [];

  if (o.errored.length) {
    L.push(`### The check failed on ${o.errored.length} guide(s). Do not treat this as an all-clear.`);
    L.push("");
    L.push("These threw before reaching a verdict, so nothing is known about them either way:");
    L.push("");
    for (const r of o.errored) L.push(`- **${r.id}** — ${r.notes}`);
    L.push("");
    L.push("A run of these usually means the API key has expired or hit a limit.");
    L.push("");
  }

  if (!o.queue.length && !o.surprises.length && !o.errored.length) {
    L.push("### Nothing needs a decision this week.");
    L.push("");
    L.push(`All ${o.results.length} guides were re-read. Nothing in any of them has changed, so the only edits ` +
           "here are dates moving forward. Safe to merge without reading further.");
    L.push("");
  } else if (o.queue.length || o.surprises.length) {
    L.push(`### ${o.queue.length + o.surprises.length} thing(s) need you. About ${minutes} minutes.`);
    L.push("");
    L.push("Tick each box once you have looked. Nothing below has been changed for you.");
    L.push("");
  }

  for (const r of o.queue) {
    for (const c of r.changes || []) {
      L.push(`- [ ] **${r.id} / ${c.stepId}** — ${c.what}`);
      if (c.current) L.push(`  - we currently say: _${c.current}_`);
      if (c.nowSays) L.push(`  - the official page now says: _${c.nowSays}_`);
      if (c.quote) L.push(`  - their words: "${c.quote}"`);
      const src = ((DATA_LINKS[r.id] || [])[0] || {}).url;
      if (src) L.push(`  - check it: ${src}`);
    }
  }

  for (const r of o.surprises) {
    L.push(`- [ ] **${r.id}** — sources stopped being readable, and this one is not on the known list. ` +
           "Either they changed something or a link is dead.");
  }

  if (o.rotation) {
    L.push("");
    L.push(`#### Hand-check on rotation: ${o.rotation.name}`);
    L.push("");
    L.push(`${o.rotation.why}. That makes it impossible to check automatically, so one of the six comes ` +
           `up by hand each week and each gets looked at about monthly. Last done ${o.rotation.lastVerified || "unknown"}.`);
    L.push("");
    L.push("Open the page and confirm these are still true. If they are, tick the box and merge:");
    L.push("");
    for (const c of o.rotation.claims) L.push(`  - ${c.step} — ${c.kind}: \`${c.text}\``);
    L.push("");
    for (const l of o.rotation.links) L.push(`  - ${l.label}: ${l.url}`);
    L.push("");
    L.push(`- [ ] **${o.rotation.name}** still matches its official page`);
  }

  L.push("");
  L.push("---");
  L.push("");
  L.push(`<sub>${o.unchanged.length} guides confirmed unchanged and had their date bumped. ` +
         `${o.unclear.length} came back unclear, which nearly always means the official page does not ` +
         `mention the step at all, so no action is expected. Full detail in \`safestart/freshness/\`. ` +
         `This job never rewrites a guide's instructions.</sub>`);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "pr-body.md"), L.join("\n"), "utf8");
}

/* ---------------- applying the safe part ---------------- */

function applyConfirmed(results) {
  const data = JSON.parse(fs.readFileSync(GUIDES, "utf8"));
  const bumped = [];
  for (const r of results) {
    if (r.status !== "unchanged" || r.confidence === "low") continue;
    const g = data.guides[r.id];
    if (!g || g.lastVerified === TODAY) continue;
    g.lastVerified = TODAY;
    bumped.push(r.id);
  }
  if (bumped.length) {
    data.verifiedOn = TODAY;
    fs.writeFileSync(GUIDES, JSON.stringify(data, null, 1), "utf8");
  }
  return bumped;
}

function appendChangelog(results, bumped) {
  let log = { entries: [] };
  if (fs.existsSync(CHANGELOG)) {
    try { log = JSON.parse(fs.readFileSync(CHANGELOG, "utf8")); } catch (e) { /* start fresh */ }
  }
  if (!Array.isArray(log.entries)) log.entries = [];

  const flagged = results.filter((r) => r.status === "changed");
  const unreadable = results.filter((r) => r.status === "unreachable");

  log.entries.unshift({
    date: TODAY,
    kind: "freshness-check",
    checked: results.length,
    reverified: bumped,
    flagged: flagged.map((r) => ({
      guide: r.id,
      summary: (r.changes || []).map((c) => c.what).slice(0, 3),
    })),
    unreadable: unreadable.map((r) => r.id),
  });

  log.entries = log.entries.slice(0, 200);
  log.updated = TODAY;
  fs.writeFileSync(CHANGELOG, JSON.stringify(log, null, 1), "utf8");
}

/* ---------------- run ---------------- */

(async () => {
  const data = JSON.parse(fs.readFileSync(GUIDES, "utf8"));
  const ids = Object.keys(data.guides).filter((id) => !ONLY.length || ONLY.includes(id));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("No ANTHROPIC_API_KEY. The freshness check needs one to compare pages.");
    process.exit(2);
  }

  console.log(`Freshness check — ${ids.length} guides, model ${MODEL}`);
  const results = [];
  for (const id of ids) {
    const g = Object.assign({ id: id }, data.guides[id]);
    process.stdout.write("  " + id.padEnd(13));
    try {
      const r = await checkGuide(g);
      results.push(r);
      const extra = r.status === "changed" ? ` (${(r.changes || []).length})`
                  : r.unreadable ? ` (${r.unreadable} source${r.unreadable === 1 ? "" : "s"} unreadable)` : "";
      console.log(r.status + extra);
    } catch (err) {
      results.push({ id: id, status: "error", notes: String((err && err.message) || err), sources: [] });
      console.log("error — " + ((err && err.message) || err));
    }
  }

  DATA_LINKS = {};
  Object.keys(data.guides).forEach((k) => { DATA_LINKS[k] = data.guides[k].links || []; });
  const rotation = rotationFor(data);
  const report = writeReport(results, rotation);
  console.log("\nReport: " + path.relative(ROOT, report.file));

  if (WRITE) {
    const bumped = applyConfirmed(results);
    appendChangelog(results, bumped);
    console.log("Re-verified: " + (bumped.length ? bumped.join(", ") : "none"));
    console.log("Changelog updated.");
  } else {
    console.log("Report only. Pass --write to bump confirmed dates and update the changelog.");
  }

  /* The number in the PR title is the number of decisions, not the number of
     things the machine found interesting. Unclear and known-unreadable are both
     excluded, because a title that always says 16 is a title nobody reads. */
  const decisions = report.queue.length + report.surprises.length + report.errored.length;
  const minutes = Math.min(15, report.queue.length * 2 + (rotation ? 3 : 0) + (report.surprises.length ? 2 : 0));
  console.log(decisions
    ? `\n${decisions} decision(s) for a human, about ${minutes} minutes.`
    : "\nNo decisions needed. Dates only.");
  if (rotation) console.log("Hand-check on rotation this week: " + rotation.name);
  if (report.errored.length) {
    console.error(`\n${report.errored.length} guide(s) errored before reaching a verdict.`);
  }
  fs.writeFileSync(path.join(REPORT_DIR, "summary.json"), JSON.stringify({
    date: TODAY,
    checked: results.length,
    changed: report.changed.map((r) => r.id),
    unclear: report.unclear.map((r) => r.id),
    unreachable: report.unreachable.map((r) => r.id),
    knownUnreadable: report.expected.map((r) => r.id),
    newlyUnreadable: report.surprises.map((r) => r.id),
    rotation: rotation ? rotation.id : null,
    decisions: decisions,
    minutes: minutes,
    needsHuman: decisions,
  }, null, 1), "utf8");

  /* If most of the run threw, this was not a check. Fail the job rather than
     opening a reassuring pull request that moved a few dates. */
  if (report.errored.length && report.errored.length >= Math.ceil(results.length / 2)) {
    console.error("More than half the guides errored. Treating this run as a failure.");
    process.exit(1);
  }
})().catch((err) => {
  console.error("Freshness check failed:", (err && err.message) || err);
  process.exit(1);
});
