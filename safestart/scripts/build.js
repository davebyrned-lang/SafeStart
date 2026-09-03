#!/usr/bin/env node
/* SafeStart build.
 *
 * Turns src/app.html plus the two JSON files into a set of real, indexable
 * pages. Every guide gets its own URL with its own title, description and
 * HowTo structured data, and its content is written into the HTML rather than
 * fetched, so a crawler and a browser with no JavaScript both see it.
 *
 * The crisis pages under /help/ are fully static for the same reason, plus one
 * more: they have to work when everything else is having a bad day.
 *
 * Output is written in place next to the source and IS committed to the repo.
 * That is deliberate: Vercel then needs no build step, so deploying stays exactly
 * what it always was, pushing files. Nothing can fail on their end.
 * After editing guides.json or safeguarding.json, run `npm run build` and commit
 * what changes.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = (process.env.SITE_URL || "https://safestart.trust-raise.com").replace(/\/$/, "");

const TEMPLATE = fs.readFileSync(path.join(ROOT, "src", "app.html"), "utf8");
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "guides.json"), "utf8"));
const SG = JSON.parse(fs.readFileSync(path.join(ROOT, "safeguarding.json"), "utf8"));
const LOG = fs.existsSync(path.join(ROOT, "changelog.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "changelog.json"), "utf8"))
  : { entries: [] };

const written = [];
const urls = [];

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Currency token substitution for prerendered output. The prerender has no
// country, so it uses the default; the client rewrites it once it knows better.
function cur(s, symbol) {
  return String(s == null ? "" : s).split("{cur}").join(symbol || "$");
}

function write(relPath, html) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html, "utf8");
  written.push(relPath);
}

function page(opts) {
  const canon = SITE + opts.url;
  return TEMPLATE
    .replace(/@TITLE@/g, esc(opts.title))
    .replace(/@OGTITLE@/g, esc(opts.ogTitle || opts.title))
    .replace(/@DESC@/g, esc(opts.description))
    .replace(/@CANON@/g, esc(canon))
    .replace(/@OGTYPE@/g, esc(opts.ogType || "website"))
    .replace(/@HEADEXTRA@/g, () => (opts.noindex ? '<meta name="robots" content="noindex,follow">\n' : "") + (opts.head || ""))
    .replace(/@MAIN@/g, () => opts.main || "");
}

function jsonLd(obj) {
  // Escaping "<" keeps a stray tag in guide prose from closing the script early.
  const json = JSON.stringify(obj, null, 1).replace(/</g, "\\u003c");
  return '<script type="application/ld+json">' + json + "</script>";
}

function isoDuration(mins) {
  return mins ? "PT" + mins + "M" : undefined;
}

function niceDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const DEFAULT_COUNTRY = (DATA.countries && DATA.countries[0]) || { id: "US", currency: "$", emergency: "911" };

/* ---------------- guide pages ---------------- */

function guideDescription(g) {
  const what = g.type === "device" ? "on " + g.name : "for " + g.name;
  return (
    "Step-by-step parental controls " + what +
    ", with the recommended setting for your child's age. " +
    (g.minutes ? "About " + g.minutes + " minutes. " : "") +
    "Free, checked against official sources."
  );
}

function renderStepStatic(step, num, symbol) {
  const out = [];
  out.push('<li class="step">');
  out.push('<div class="step-head"><span class="step-num">' + num + "</span>");
  out.push('<span class="num-text"><h3>' + esc(step.title) + "</h3></span></div>");
  out.push('<div class="step-body">');

  if (step.why) out.push('<p class="why">' + esc(step.why) + "</p>");
  if (step.path) out.push('<p class="path"><code>' + esc(step.path) + "</code></p>");

  if (step.do && step.do.length) {
    out.push('<ol class="do-list">');
    step.do.forEach((d) => out.push("<li>" + esc(d) + "</li>"));
    out.push("</ol>");
  }

  if (step.recommended) {
    out.push('<div class="rec"><span class="rec-label">Recommended by age</span>');
    out.push('<table class="rec-table"><tbody>');
    Object.keys(step.recommended).forEach((k) => {
      const band = (DATA.ageBands || []).filter((b) => b.id === k)[0];
      out.push(
        "<tr><td>" + esc(band ? band.label : k) + "</td>" +
        "<td>" + esc(cur(step.recommended[k], symbol)) + "</td></tr>"
      );
    });
    out.push("</tbody></table></div>");
  }

  if (step.result) out.push('<p class="result">' + esc(step.result) + "</p>");
  if (step.note) out.push('<p class="note">' + esc(step.note) + "</p>");

  out.push("</div></li>");
  return out.join("");
}

function renderGuideStatic(g) {
  const symbol = DEFAULT_COUNTRY.currency;
  const out = [];

  out.push('<a class="back-link" href="/">All guides</a>');
  out.push('<div class="guide-head"><h1 class="guide-title">' + esc(g.name) + "</h1></div>");
  if (g.blurb) out.push('<p class="guide-blurb">' + esc(g.blurb) + "</p>");

  const meta = [];
  if (g.kind) meta.push('<span class="pill">' + esc(g.kind) + "</span>");
  if (g.minutes) meta.push('<span class="pill">About ' + g.minutes + " minutes</span>");
  if (g.sourceConfidence) {
    meta.push('<span class="pill conf-' + esc(g.sourceConfidence) + '">Source confidence: ' + esc(g.sourceConfidence) + "</span>");
  }
  if (g.lastVerified) meta.push('<span class="pill">Checked ' + esc(niceDate(g.lastVerified)) + "</span>");
  if (meta.length) out.push('<div class="meta-row">' + meta.join("") + "</div>");

  /* The younger-child alternative goes into the markup, not just the app, so a
     parent who lands here from a search engine sees it without running any JS.
     Country-limited ones still render: the copy itself names where they apply. */
  if (g.kidsAlt) {
    const a = g.kidsAlt;
    out.push('<div class="kid-card">');
    out.push("<h3>There is a version built for younger children</h3>");
    out.push("<p>" + esc(a.name + ", " + a.form + ". " + a.what) + "</p>");
    out.push('<p class="kid-watch">' + esc("Worth knowing: " + a.watchOut) + "</p>");
    if (a.countryNote) out.push('<p class="kid-watch">' + esc(a.countryNote) + "</p>");
    const midName = /^(A|An|The) /.test(a.name) ? a.name.charAt(0).toLowerCase() + a.name.slice(1) : a.name;
    out.push('<a class="alt-link" href="' + esc(a.link) + '" target="_blank" rel="noopener">' +
      esc("The official page for " + midName) + "</a>");
    out.push("</div>");
  } else if (g.noKidsAlt) {
    out.push('<div class="kid-card muted-card">');
    out.push("<h3>" + esc("There is no younger version of " + g.name) + "</h3>");
    out.push("<p>" + esc(g.noKidsAlt) + "</p>");
    out.push("</div>");
  }

  if (g.risks && g.risks.length) {
    out.push('<div class="check-card"><h2>What to watch for</h2><ul>');
    g.risks.forEach((r) => out.push("<li>" + esc(r) + "</li>"));
    out.push("</ul></div>");
  }

  if (g.beforeYouStart && g.beforeYouStart.length) {
    out.push('<div class="check-card"><h2>Before you start</h2><ul>');
    g.beforeYouStart.forEach((b) => out.push("<li>" + esc(b) + "</li>"));
    out.push("</ul></div>");
  }

  if (g.steps && g.steps.length) {
    out.push('<ol class="steps">');
    g.steps.forEach((s, i) => out.push(renderStepStatic(s, i + 1, symbol)));
    out.push("</ol>");
  }

  if (g.checklist && g.checklist.length) {
    out.push('<div class="check-card"><h2>Safety check</h2><ul class="check-list">');
    g.checklist.forEach((c) => out.push('<li class="check-item">' + esc(c) + "</li>"));
    out.push("</ul></div>");
  }

  if (g.talkAboutIt && g.talkAboutIt.length) {
    out.push('<div class="check-card"><h2>Worth talking about</h2><ul class="talk-list">');
    g.talkAboutIt.forEach((t) => out.push("<li>" + esc(t) + "</li>"));
    out.push("</ul></div>");
  }

  if (g.links && g.links.length) {
    out.push('<div class="check-card"><h2>Official sources</h2><ul class="link-list">');
    g.links.forEach((l) => {
      out.push('<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label) + "</a></li>");
    });
    out.push("</ul></div>");
  }

  out.push(helpCardStatic());
  out.push('<p class="disclaimer">Menus move. If something on screen does not match these steps, check the official link above.</p>');

  return out.join("\n");
}

function helpCardStatic() {
  return (
    '<a class="help-card" href="/help/">' +
    '<span class="help-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg></span>' +
    "<span><strong>Has something already happened?</strong>" +
    "<span>If your child has been contacted by an adult, is being threatened over an image, or is being bullied, settings are not the first thing to deal with. Here is what to do, and who to tell.</span>" +
    "</span></a>"
  );
}

function guideJsonLd(g) {
  const url = SITE + "/" + g.id + "/";
  const steps = (g.steps || []).map((s, i) => {
    const text = [s.why, (s.do || []).join(" ")].filter(Boolean).join(" ").trim();
    return {
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: text || s.title,
      url: url + "#step-" + (i + 1)
    };
  });

  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to set up parental controls on " + g.name,
    description: guideDescription(g),
    totalTime: isoDuration(g.minutes),
    step: steps,
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "TrustRaise", url: "https://trust-raise.com" }
  };
  if (g.beforeYouStart && g.beforeYouStart.length) {
    howTo.supply = g.beforeYouStart.map((b) => ({ "@type": "HowToSupply", name: b }));
  }

  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "SafeStart", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: g.name, item: url }
    ]
  };

  return jsonLd(howTo) + "\n" + jsonLd(crumbs);
}

/* ---------------- home ---------------- */

function renderHomeStatic() {
  const guides = DATA.guides;
  const ids = Object.keys(guides);
  const apps = ids.filter((id) => guides[id].type === "app");
  const devices = ids.filter((id) => guides[id].type !== "app");

  const list = (title, arr) => {
    const items = arr
      .map((id) => {
        const g = guides[id];
        return (
          '<li><a href="/' + esc(id) + '/"><strong>' + esc(g.name) + "</strong>" +
          (g.minutes ? " <span>About " + g.minutes + " minutes</span>" : "") +
          "</a></li>"
        );
      })
      .join("");
    return '<div class="check-card"><h2>' + esc(title) + '</h2><ul class="link-list">' + items + "</ul></div>";
  };

  return [
    '<section class="hero">',
    "<h1>Let's set this up <span class=\"hl\">together</span>.</h1>",
    "<p>Tell me whose device it is and what they use. You get one plan, in the order that removes the most risk first, broken into short sittings rather than one long evening.</p>",
    "</section>",
    helpCardStatic(),
    list("Apps and games", apps),
    list("Phones, computers and consoles", devices)
  ].join("\n");
}

function homeJsonLd() {
  return (
    jsonLd({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "SafeStart",
      url: SITE + "/",
      description: "Free step-by-step parental control guides for parents, from TrustRaise.",
      publisher: { "@type": "Organization", name: "TrustRaise", url: "https://trust-raise.com" }
    }) +
    "\n" +
    jsonLd({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "SafeStart parental control guides",
      itemListElement: Object.keys(DATA.guides).map((id, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: DATA.guides[id].name,
        url: SITE + "/" + id + "/"
      }))
    })
  );
}


/* ---------------- changelog ----------------
   Anyone can put a "last checked" date on a page. Publishing the record of what
   actually changed, including the corrections, is the part that can be checked.
   Freshness runs append themselves here automatically. */

const KIND_LABEL = {
  correction: "Correction",
  verification: "Verification",
  site: "Change",
  "freshness-check": "Freshness check",
};

function renderChangelogStatic() {
  const out = [];
  out.push('<a class="back-link" href="/">Back to SafeStart</a>');
  out.push('<div class="guide-head"><h1 class="guide-title">What has changed</h1></div>');
  out.push('<p class="guide-blurb">' + esc(LOG.intro || "") + "</p>");

  const corrections = (LOG.entries || []).filter((e) => e.kind === "correction").length;
  const checks = (LOG.entries || []).filter((e) => e.kind === "freshness-check").length;
  const meta = ['<span class="pill">' + (LOG.entries || []).length + " entries</span>"];
  if (corrections) meta.push('<span class="pill">' + corrections + (corrections === 1 ? " correction" : " corrections") + "</span>");
  if (checks) meta.push('<span class="pill">' + checks + (checks === 1 ? " automated check" : " automated checks") + "</span>");
  out.push('<div class="meta-row">' + meta.join("") + "</div>");

  (LOG.entries || []).forEach((e) => {
    out.push('<article class="log-entry log-' + esc(e.kind || "site") + '">');
    out.push('<div class="log-head"><span class="log-kind">' +
      esc(KIND_LABEL[e.kind] || "Change") + '</span><time>' + esc(niceDate(e.date)) + "</time></div>");

    if (e.kind === "freshness-check") {
      const bits = [];
      bits.push(e.checked + " guides re-read against their official sources.");
      if ((e.reverified || []).length) bits.push("Confirmed unchanged: " + e.reverified.join(", ") + ".");
      if ((e.flagged || []).length) {
        bits.push("Flagged for review: " + e.flagged.map((f) => f.guide).join(", ") + ".");
      } else {
        bits.push("Nothing needed changing.");
      }
      if ((e.unreadable || []).length) bits.push("Sources unreachable: " + e.unreadable.join(", ") + ".");
      out.push("<h2>Weekly source check</h2>");
      out.push("<p>" + esc(bits.join(" ")) + "</p>");
      (e.flagged || []).forEach((f) => {
        (f.summary || []).forEach((line) => out.push('<p class="log-detail">' + esc(f.guide) + ": " + esc(line) + "</p>"));
      });
    } else {
      out.push("<h2>" + esc(e.title || "") + "</h2>");
      out.push("<p>" + esc(e.body || "") + "</p>");
    }
    out.push("</article>");
  });

  out.push('<p class="disclaimer">This page is generated from the same file the weekly check writes to, so it cannot quietly fall behind what actually happened.</p>');
  return out.join("\n");
}

/* ---------------- crisis pages ---------------- */

function countryById(id) {
  return (DATA.countries || []).filter((c) => c.id === id)[0] || DEFAULT_COUNTRY;
}

function renderHelpShared(country) {
  const out = [];
  const c = countryById(country);
  const cc = SG.byCountry[country];

  // The emergency line comes first on every one of these pages, before any
  // navigation, explanation or branding.
  out.push(
    '<div class="emergency"><strong>If your child is in immediate danger, call ' +
    esc(cc.police.emergency) + ".</strong> " + esc(cc.police.line) + "</div>"
  );

  out.push('<div class="guide-head"><h1 class="guide-title">' + esc(SG.title) + "</h1></div>");
  out.push('<p class="guide-blurb">' + esc(SG.lede) + "</p>");

  out.push('<p class="country-note">Showing help for <strong>' + esc(c.label) + "</strong>. " +
    (DATA.countries || [])
      .filter((x) => x.id !== country)
      .map((x) => '<a href="/help/' + x.id.toLowerCase() + '/">' + esc(x.label) + "</a>")
      .join(" &middot; ") +
    "</p>");

  // first things
  out.push('<div class="check-card"><h2>' + esc(SG.firstThings.title) + "</h2>");
  out.push('<ol class="steps">');
  SG.firstThings.steps.forEach((s, i) => {
    out.push('<li class="step"><div class="step-head"><span class="step-num">' + (i + 1) + "</span>");
    out.push('<span class="num-text"><h3>' + esc(s.title) + "</h3></span></div>");
    out.push('<div class="step-body"><p>' + esc(s.body) + "</p></div></li>");
  });
  out.push("</ol>");
  // Said once, here, rather than by name-dropping an agency inside each piece of
  // advice. A parent in Manchester does not need to read about the Irish police
  // to be told not to delete the messages.
  if (SG.provenance) out.push('<p class="note">' + esc(SG.provenance) + "</p>");
  out.push("</div>");

  // where to report
  out.push('<div class="check-card"><h2>Where to report it</h2>');
  cc.bodies.forEach((b) => {
    out.push('<div class="body-card' + (b.primary ? " primary" : "") + '">');
    out.push("<h3>" + (b.url ? '<a href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">' + esc(b.name) + "</a>" : esc(b.name)) + "</h3>");
    out.push("<p>" + esc(b.what) + "</p>");
    if (b.phone) out.push('<p class="phone">' + esc(b.phone) + "</p>");
    if (b.caveatNote) out.push('<p class="note">' + esc(b.caveatNote) + "</p>");
    out.push("</div>");
  });
  out.push('<p class="note">' + esc(cc.police.nonEmergency) + "</p>");
  out.push('<p class="note"><strong>' + esc(SG.standingLine) + "</strong></p>");
  out.push("</div>");

  // situations
  out.push("<h2 class=\"section-h\">What has happened?</h2>");
  SG.situations.forEach((s) => {
    out.push('<section class="check-card situation" id="' + esc(s.id) + '">');
    out.push("<h2>" + esc(s.label) + "</h2>");
    out.push('<p class="guide-blurb">' + esc(s.summary) + "</p>");
    // Advice with a `countries` list is local to those countries and is left off
    // every other page. Everything else is universal and appears everywhere.
    s.keyAdvice
      .filter((a) => !a.countries || a.countries.indexOf(country) !== -1)
      .forEach((a) => {
        out.push('<div class="advice"><h3>' + esc(a.title) + "</h3><p>" + esc(a.body) + "</p></div>");
      });
    if (s.context) out.push('<p class="note">' + esc(s.context) + "</p>");
    if (s.countryNotes && s.countryNotes[country]) {
      out.push('<p class="note">' + esc(s.countryNotes[country]) + "</p>");
    }
    // Citations sit under the advice rather than inside it, so the instruction
    // reads as an instruction and the sourcing is still there for anyone checking.
    if (s.sources) out.push('<p class="tiny">Sources: ' + esc(s.sources) + "</p>");
    out.push("</section>");
  });

  // evidence
  out.push('<div class="check-card"><h2>' + esc(SG.evidence.title) + "</h2>");
  out.push("<p>" + esc(SG.evidence.intro) + "</p>");
  out.push("<ul>");
  SG.evidence.official.forEach((e) => out.push("<li>" + esc(e) + "</li>"));
  SG.evidence.practical.forEach((e) => out.push("<li>" + esc(e) + " <em>(SafeStart guidance)</em></li>"));
  out.push("</ul>");
  out.push('<p class="note">' + esc(SG.evidence.note) + "</p>");
  out.push("</div>");

  // platforms
  out.push('<div class="check-card"><h2>Reporting on the platform itself</h2>');
  out.push("<p>" + esc(SG.platformsNote) + "</p>");
  out.push('<table class="rec-table platform-table"><tbody>');
  SG.platforms.forEach((p) => {
    out.push("<tr><td><strong>" + esc(p.name) + "</strong>" +
      (p.confidence === "low" ? '<br><span class="tiny">In-app only, verified</span>' : "") +
      "</td><td>" + esc(p.route) +
      (p.url ? ' <a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + esc(p.urlLabel || "Open") + "</a>" : "") +
      "</td></tr>");
  });
  out.push("</tbody></table></div>");

  // what to say
  out.push('<div class="check-card"><h2>' + esc(SG.talking.title) + "</h2>");
  SG.talking.lines.forEach((l) => {
    out.push('<blockquote class="say">' + esc(l.text) + "</blockquote>");
    out.push('<p class="note">' + esc(l.note) + "</p>");
  });
  out.push("</div>");

  out.push('<p class="disclaimer">' + esc(SG.disclaimer) + " Last checked " + esc(niceDate(SG.verifiedOn)) + ".</p>");

  return out.join("\n");
}

function renderHelpIndex() {
  const out = [];
  out.push('<div class="emergency"><strong>If your child is in immediate danger, call your local emergency number now.</strong> 911 in the US and Canada, 999 in the UK, 999 or 112 in Ireland.</div>');
  out.push('<div class="guide-head"><h1 class="guide-title">' + esc(SG.title) + "</h1></div>");
  out.push('<p class="guide-blurb">' + esc(SG.lede) + "</p>");
  out.push("<h2 class=\"section-h\">Where are you?</h2>");
  out.push('<p>Reporting routes are different in each country, so pick yours and we will show the right ones.</p>');
  out.push('<div class="check-card"><ul class="link-list">');
  (DATA.countries || []).forEach((c) => {
    out.push('<li><a href="/help/' + c.id.toLowerCase() + '/"><strong>' + esc(c.label) + "</strong></a></li>");
  });
  out.push("</ul></div>");

  out.push('<div class="check-card"><h2>' + esc(SG.firstThings.title) + "</h2><ol class=\"steps\">");
  SG.firstThings.steps.forEach((s, i) => {
    out.push('<li class="step"><div class="step-head"><span class="step-num">' + (i + 1) + "</span>");
    out.push('<span class="num-text"><h3>' + esc(s.title) + "</h3></span></div>");
    out.push('<div class="step-body"><p>' + esc(s.body) + "</p></div></li>");
  });
  out.push("</ol></div>");
  out.push('<p class="disclaimer">' + esc(SG.disclaimer) + "</p>");
  return out.join("\n");
}

/* ---------------- run ---------------- */

function build() {
  // home
  write("index.html", page({
    url: "/",
    title: "SafeStart — parental controls made simple",
    description: "Free step-by-step parental control setup for the apps, games and devices your child uses. Pick their age, pick the device, get a clear checklist. A free tool from TrustRaise.",
    head: homeJsonLd(),
    main: renderHomeStatic()
  }));
  urls.push({ loc: SITE + "/", priority: "1.0" });

  // guides
  Object.keys(DATA.guides).forEach((id) => {
    const g = DATA.guides[id];
    write(id + "/index.html", page({
      url: "/" + id + "/",
      title: g.name + " parental controls — a step-by-step guide for parents | SafeStart",
      ogTitle: "Parental controls for " + g.name,
      description: guideDescription(g),
      ogType: "article",
      head: guideJsonLd(g),
      main: renderGuideStatic(g)
    }));
    urls.push({ loc: SITE + "/" + id + "/", priority: "0.9", lastmod: g.lastVerified });
  });

  write("changelog/index.html", page({
    url: "/changelog/",
    title: "What has changed — SafeStart",
    description: "Every correction and every automated source check on SafeStart's parental control guides, with dates. Published so the verification dates can be checked rather than taken on trust.",
    main: renderChangelogStatic()
  }));
  urls.push({ loc: SITE + "/changelog/", priority: "0.5", lastmod: LOG.updated });

  // The plan is built in the browser from whatever is in the query string, so
  // there is no fixed content to prerender and nothing to index. The shell just
  // has to exist so the path resolves.
  write("plan/index.html", page({
    url: "/plan/",
    title: "Your setup plan — SafeStart",
    description: "A merged parental control plan for one child's device and the apps they use.",
    noindex: true,
    main: '<div class="loading"><div class="spinner"></div></div>' +
          '<noscript><p class="disclaimer">Building a plan needs JavaScript. ' +
          'Every individual guide works without it — <a href="/">browse them here</a>.</p></noscript>'
  }));

  // crisis pages
  write("help/index.html", page({
    url: "/help/",
    title: "Something has happened — SafeStart",
    description: "If your child has been contacted by an adult, threatened over an image, or bullied online, here is what to do first and who to report it to.",
    main: renderHelpIndex()
  }));
  urls.push({ loc: SITE + "/help/", priority: "0.9" });

  (DATA.countries || []).forEach((c) => {
    const slug = c.id.toLowerCase();
    write("help/" + slug + "/index.html", page({
      url: "/help/" + slug + "/",
      title: "Something has happened — help for parents in " + c.label + " | SafeStart",
      description:
        "What to do first if your child has been groomed, threatened over an image, or bullied online. Reporting routes for " +
        c.label + ", checked against official sources.",
      main: renderHelpShared(c.id)
    }));
    urls.push({ loc: SITE + "/help/" + slug + "/", priority: "0.9", lastmod: SG.verifiedOn });
  });

  // sitemap
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          "  <url><loc>" + esc(u.loc) + "</loc>" +
          (u.lastmod ? "<lastmod>" + esc(u.lastmod) + "</lastmod>" : "") +
          "<priority>" + u.priority + "</priority></url>"
      )
      .join("\n") +
    "\n</urlset>\n";
  write("sitemap.xml", sitemap);

  write(
    "robots.txt",
    ["User-agent: *", "Allow: /", "Disallow: /api/", "", "Sitemap: " + SITE + "/sitemap.xml", ""].join("\n")
  );

  console.log("SafeStart build");
  console.log("  site:   " + SITE);
  console.log("  guides: " + Object.keys(DATA.guides).length);
  console.log("  pages:  " + written.length);
  written.forEach((w) => console.log("    " + w));
}

build();
