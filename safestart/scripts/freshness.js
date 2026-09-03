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

/* ---------------- report ---------------- */

function writeReport(results) {
  const changed = results.filter((r) => r.status === "changed");
  const unclear = results.filter((r) => r.status === "unclear");
  const unchanged = results.filter((r) => r.status === "unchanged");
  const unreachable = results.filter((r) => r.status === "unreachable" || r.status === "no-sources");

  const L = [];
  L.push("# Freshness check — " + TODAY);
  L.push("");
  L.push(`${results.length} guides checked. **${changed.length} look changed**, ${unclear.length} unclear, ` +
         `${unchanged.length} unchanged, ${unreachable.length} could not be read.`);
  L.push("");
  L.push("Nothing in `guides.json` has been rewritten by this job. Confirmed-unchanged guides had their " +
         "`lastVerified` date bumped, because that is a fact this run established. Everything below needs a human.");
  L.push("");

  if (changed.length) {
    L.push("## Looks changed");
    L.push("");
    for (const r of changed) {
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

  if (unclear.length) {
    L.push("## Unclear");
    L.push("");
    for (const r of unclear) L.push(`- **${r.id}** — ${r.notes || "sources did not settle it"}`);
    L.push("");
  }

  if (unreachable.length) {
    L.push("## Could not be read");
    L.push("");
    for (const r of unreachable) {
      const why = (r.sources || []).filter((s) => !s.ok).map((s) => `${s.url} (${s.reason})`);
      L.push(`- **${r.id}** — ${why.join("; ") || "no sources listed"}`);
    }
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
  return { file, changed, unclear, unchanged, unreachable, markdown: L.join("\n") };
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
      results.push({ id: id, status: "unclear", notes: String((err && err.message) || err), sources: [] });
      console.log("error — " + ((err && err.message) || err));
    }
  }

  const report = writeReport(results);
  console.log("\nReport: " + path.relative(ROOT, report.file));

  if (WRITE) {
    const bumped = applyConfirmed(results);
    appendChangelog(results, bumped);
    console.log("Re-verified: " + (bumped.length ? bumped.join(", ") : "none"));
    console.log("Changelog updated.");
  } else {
    console.log("Report only. Pass --write to bump confirmed dates and update the changelog.");
  }

  // A non-zero-but-not-failing signal the workflow can branch on.
  const needsHuman = report.changed.length + report.unclear.length;
  console.log(needsHuman ? `\n${needsHuman} guide(s) need a human look.` : "\nNothing needs a human this week.");
  fs.writeFileSync(path.join(REPORT_DIR, "summary.json"), JSON.stringify({
    date: TODAY,
    checked: results.length,
    changed: report.changed.map((r) => r.id),
    unclear: report.unclear.map((r) => r.id),
    unreachable: report.unreachable.map((r) => r.id),
    needsHuman: needsHuman,
  }, null, 1), "utf8");
})().catch((err) => {
  console.error("Freshness check failed:", (err && err.message) || err);
  process.exit(1);
});
