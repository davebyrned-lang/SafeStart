#!/usr/bin/env node
// Sanity checks for the guide database and the API handlers.
//   node scripts/check.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let warnings = 0;

function fail(msg) { failures++; console.error('  FAIL  ' + msg); }
function warn(msg) { warnings++; console.warn('  warn  ' + msg); }
function ok(msg) { console.log('  ok    ' + msg); }

console.log('\nguides.json');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'guides.json'), 'utf8'));

const bandIds = data.ageBands.map((b) => b.id);
const deviceIds = data.devices.map((d) => d.id);
ok(`${Object.keys(data.guides).length} guides, ${bandIds.length} age bands, ${deviceIds.length} devices`);

data.ageBands.forEach((b) => {
  if (!data.profiles[b.profile]) fail(`age band ${b.id} points at missing profile "${b.profile}"`);
});

let stepCount = 0;
Object.entries(data.guides).forEach(([id, g]) => {
  if (g.id !== id) fail(`${id}: id field is "${g.id}"`);
  if (!g.name) fail(`${id}: no name`);
  if (!g.kind) fail(`${id}: no kind`);
  if (!['app', 'device', 'start'].includes(g.type)) fail(`${id}: type is "${g.type}"`);
  if (!g.lastVerified || !/^\d{4}-\d{2}-\d{2}$/.test(g.lastVerified)) fail(`${id}: bad lastVerified`);
  if (!['high', 'medium', 'limited'].includes(g.sourceConfidence)) fail(`${id}: bad sourceConfidence`);
  if (!Array.isArray(g.steps) || !g.steps.length) fail(`${id}: no steps`);
  if (!Array.isArray(g.checklist) || !g.checklist.length) warn(`${id}: no checklist`);
  if (!Array.isArray(g.links) || !g.links.length) fail(`${id}: no official links`);

  (g.devices || []).forEach((d) => {
    if (!deviceIds.includes(d)) fail(`${id}: unknown device "${d}"`);
  });

  const seen = new Set();
  (g.steps || []).forEach((s, i) => {
    stepCount++;
    const where = `${id} step ${i + 1}`;
    if (!s.id) fail(`${where}: no id`);
    if (seen.has(s.id)) fail(`${where}: duplicate step id "${s.id}"`);
    seen.add(s.id);
    if (!s.title) fail(`${where}: no title`);
    if (!s.why) warn(`${where}: no "why"`);
    if (!Array.isArray(s.do) || !s.do.length) fail(`${where}: no instructions`);
    if (s.ages) {
      s.ages.forEach((a) => { if (!bandIds.includes(a)) fail(`${where}: unknown age band "${a}"`); });
    }
    if (s.recommended) {
      Object.keys(s.recommended).forEach((a) => {
        if (!bandIds.includes(a)) fail(`${where}: recommended has unknown band "${a}"`);
      });
      // A step limited to certain ages only needs recommendations for those ages,
      // and an app with a minimum age doesn't need them for bands below it.
      const need = (s.ages && s.ages.length ? s.ages : bandIds)
        .filter((a) => parseInt(a, 10) >= (g.minAge || 0));
      need.forEach((a) => {
        if (!s.recommended[a]) warn(`${where}: no recommendation for ${a}`);
      });
    }
  });

  (g.links || []).forEach((l) => {
    if (!l.url || !/^https?:\/\//.test(l.url)) fail(`${id}: bad link url "${l.url}"`);
    if (!l.label) fail(`${id}: link with no label`);
  });

  // Every age band should have at least one visible step.
  bandIds.forEach((band) => {
    const visible = g.steps.filter((s) => !s.ages || s.ages.includes(band));
    if (!visible.length) fail(`${id}: no steps visible for ages ${band}`);
  });
});
ok(`${stepCount} steps validated`);

// A kids alternative is a claim a parent will act on, so the shape is enforced:
// it has to name itself, say what it is and what to watch for, and cite a page.
console.log('\nyounger-child alternatives');
const altCountryIds = (data.countries || []).map((c) => c.id);
let altCount = 0;
Object.keys(data.guides).forEach((id) => {
  const a = data.guides[id].kidsAlt;
  if (!a) return;
  altCount++;
  ['name', 'form', 'what', 'watchOut', 'link', 'confidence'].forEach((k) => {
    if (!a[k]) fail(`${id}: kidsAlt is missing ${k}`);
  });
  if (!Array.isArray(a.bands) || !a.bands.length) fail(`${id}: kidsAlt has no bands`);
  (a.bands || []).forEach((b) => {
    if (!bandIds.includes(b)) fail(`${id}: kidsAlt names unknown band "${b}"`);
  });
  (a.countries || []).forEach((c) => {
    if (!altCountryIds.includes(c)) fail(`${id}: kidsAlt names unknown country "${c}"`);
  });
  if (a.link && !/^https:\/\//.test(a.link)) fail(`${id}: kidsAlt link is not https`);
  if (!['high', 'medium', 'low'].includes(a.confidence)) {
    fail(`${id}: kidsAlt confidence "${a.confidence}" is not high, medium or low`);
  }
  if (data.guides[id].noKidsAlt) fail(`${id}: has both a kidsAlt and a noKidsAlt`);
});
ok(`${altCount} younger-child alternatives validated`);

// Anything with a 13+ minimum and no alternative must say so, otherwise the
// warning dialog falls back to generic copy and the parent learns nothing.
Object.keys(data.guides).forEach((id) => {
  const g = data.guides[id];
  if (g.type !== 'app' || !g.minAge || g.kidsAlt || g.noKidsAlt) return;
  fail(`${id}: minimum age ${g.minAge} but no kidsAlt and no noKidsAlt explaining why`);
});
ok('every age-restricted app either offers an alternative or says there is none');

// Every device guide should say what already ships on it. A parent does not
// install YouTube on an Android tablet, so it never occurs to them to set it up.
console.log('\nwhat ships on the device');
let preCount = 0;
Object.keys(data.guides).forEach((id) => {
  const g = data.guides[id];
  if (g.type !== 'device') {
    if (g.preinstalled) fail(`${id}: only device guides should list preinstalled apps`);
    return;
  }
  if (!Array.isArray(g.preinstalled) || !g.preinstalled.length) {
    fail(`${id}: device guide with no preinstalled list`);
    return;
  }
  preCount += g.preinstalled.length;
});
ok(`${preCount} preinstalled apps listed across the device guides`);

// Exactly one "start here" guide, and it must lead every plan.
const starts = Object.keys(data.guides).filter((id) => data.guides[id].type === 'start');
if (starts.length !== 1) fail(`expected exactly one start guide, found ${starts.length}`);
else if (data.guides[starts[0]].priority !== 0) fail(`${starts[0]}: start guide must be priority 0`);
else ok(`start guide is ${starts[0]}`);

console.log('\napi handlers');
['guide', 'ask'].forEach((name) => {
  const file = path.join(ROOT, 'api', name + '.js');
  try {
    const handler = require(file);
    if (typeof handler !== 'function') fail(`api/${name}.js does not export a function`);
    else ok(`api/${name}.js loads`);
  } catch (err) {
    fail(`api/${name}.js threw on load: ${err.message}`);
  }
});

['_lib/prompt', '_lib/anthropic', '_lib/ratelimit', '_lib/guidetext'].forEach((name) => {
  try {
    require(path.join(ROOT, 'api', name + '.js'));
    ok(`api/${name}.js loads`);
  } catch (err) {
    fail(`api/${name}.js threw on load: ${err.message}`);
  }
});

console.log('\nprompt');
const { chatSystemPrompt, guideSystemPrompt } = require(path.join(ROOT, 'api/_lib/prompt.js'));
const { guideToText } = require(path.join(ROOT, 'api/_lib/guidetext.js'));
const sample = chatSystemPrompt({
  ageBand: '11–12',
  deviceLabel: 'iPad',
  appLabel: 'Roblox',
  guideText: guideToText(data.guides.roblox, '11-12'),
  verifiedOn: data.guides.roblox.lastVerified,
});
if (sample.length < 2000) fail('chat system prompt looks too short');
else ok(`chat system prompt builds (${sample.length} chars)`);
if (!/```json/.test(guideSystemPrompt())) fail('guide system prompt is missing the JSON schema block');
else ok('guide system prompt builds');

console.log('\nsrc/app.html');
const html = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
if (!/fetch\("\/guides\.json"\)/.test(html)) fail('app template does not fetch /guides.json');
else ok('fetches /guides.json');
if (!/\/api\/guide\?/.test(html)) fail('app template does not call /api/guide');
else ok('calls /api/guide');
if (!/\/api\/ask/.test(html)) fail('app template does not call /api/ask');
else ok('calls /api/ask');
['@TITLE@', '@DESC@', '@CANON@', '@HEADEXTRA@', '@MAIN@', '@ANALYTICS@'].forEach((tok) => {
  if (html.indexOf(tok) === -1) fail('app template is missing the ' + tok + ' placeholder');
  else ok('has ' + tok);
});
if (/(?:src|href)="assets\//.test(html)) {
  fail('app template has relative asset paths, which break on nested URLs like /roblox/');
} else ok('asset paths are absolute');

// --- safeguarding data -------------------------------------------------------
console.log('\nsafeguarding.json');
const SG = JSON.parse(fs.readFileSync(path.join(ROOT, 'safeguarding.json'), 'utf8'));
const countryIds = (data.countries || []).map((c) => c.id);
if (!countryIds.length) fail('guides.json has no countries block');
else ok('countries: ' + countryIds.join(', '));

countryIds.forEach((id) => {
  const cc = SG.byCountry[id];
  if (!cc) return fail('safeguarding.json has no entry for ' + id);
  if (!cc.police || !cc.police.emergency) fail(id + ' has no emergency number');
  if (!cc.bodies || !cc.bodies.length) fail(id + ' has no reporting bodies');
  else {
    const bad = cc.bodies.filter((b) => b.url && !/^https:\/\//.test(b.url));
    if (bad.length) fail(id + ' has a non-https reporting URL: ' + bad[0].url);
    else ok(id + ': ' + cc.bodies.length + ' reporting bodies, emergency ' + cc.police.emergency);
  }
});
if (!SG.situations || SG.situations.length < 3) fail('safeguarding.json needs at least three situations');
else ok(SG.situations.length + ' situations');
SG.platforms.forEach((p) => {
  if (!p.route) fail('platform ' + p.id + ' has no route described');
  if (p.url && !p.urlLabel) fail('platform ' + p.id + ' has a URL with no label');
});
ok(SG.platforms.length + ' platform reporting routes');
const unverified = SG.platforms.filter((p) => p.confidence === 'low');
if (unverified.length) {
  warn('in-app-only platforms (no verified web form): ' + unverified.map((p) => p.id).join(', '));
}

// --- plan metadata -----------------------------------------------------------
console.log('\nplan merging');
const apps = Object.keys(data.guides).filter((id) => data.guides[id].type === 'app');
const devices = Object.keys(data.guides).filter((id) => data.guides[id].type === 'device');
const noPriority = apps.filter((id) => typeof data.guides[id].priority !== 'number');
if (noPriority.length) fail('apps with no priority, so plan ordering is arbitrary: ' + noPriority.join(', '));
else ok(apps.length + ' apps have an ordering priority');
if (devices.some((id) => data.guides[id].priority !== 0)) fail('every device guide must be priority 0 so it leads the plan');
else ok('devices lead every plan');

const noMins = [];
Object.keys(data.guides).forEach((id) => {
  (data.guides[id].steps || []).forEach((s) => { if (!s.mins) noMins.push(id + ':' + s.id); });
});
if (noMins.length) fail(noMins.length + ' steps have no minute estimate, so sittings cannot be sized');
else ok('every step carries a minute estimate');

// A redundantWith tag that nothing provides is a silent no-op: the step never
// gets merged away and the parent does the same thing twice.
const provided = new Set();
Object.keys(data.guides).forEach((id) => {
  (data.guides[id].steps || []).forEach((s) => (s.provides || []).forEach((t) => provided.add(t)));
});
const orphans = [];
Object.keys(data.guides).forEach((id) => {
  (data.guides[id].steps || []).forEach((s) => {
    (s.redundantWith || []).forEach((t) => { if (!provided.has(t)) orphans.push(id + ':' + s.id + ' -> ' + t); });
  });
});
if (orphans.length) fail('redundantWith tags nothing provides: ' + orphans.join(', '));
else ok(provided.size + ' overlap tags, all of them matched');

// --- changelog ---------------------------------------------------------------
console.log('\nchangelog');
const log = JSON.parse(fs.readFileSync(path.join(ROOT, 'changelog.json'), 'utf8'));
if (!Array.isArray(log.entries) || !log.entries.length) fail('changelog has no entries');
else ok(log.entries.length + ' changelog entries');
const badDates = (log.entries || []).filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.date || ''));
if (badDates.length) fail(badDates.length + ' changelog entries have no usable date');
else ok('every entry is dated');
if (!(log.entries || []).some((e) => e.kind === 'correction')) {
  warn('no corrections logged yet — the changelog is only worth publishing if it includes them');
}

// --- currency tokens ---------------------------------------------------------
console.log('\ncurrency');
const rawGuides = fs.readFileSync(path.join(ROOT, 'guides.json'), 'utf8');
if (/£\d+\s*\/\s*\$/.test(rawGuides)) {
  fail('guides.json still hard-codes two currency symbols in one string; use the {cur} token');
} else ok('no hard-coded dual-currency strings');
const curCount = (rawGuides.match(/\{cur\}/g) || []).length;
ok(curCount + ' {cur} tokens, substituted per country at render time');

// --- build output ------------------------------------------------------------
console.log('\nbuild output');
const expected = ['index.html', 'sitemap.xml', 'robots.txt', 'help/index.html',
                  'changelog/index.html', 'plan/index.html']
  .concat(countryIds.map((c) => 'help/' + c.toLowerCase() + '/index.html'))
  .concat(Object.keys(data.guides).map((id) => id + '/index.html'));
const missing = expected.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) fail('not built yet (run npm run build): ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? ' and ' + (missing.length - 3) + ' more' : ''));
else ok(expected.length + ' pages present');

if (!missing.length) {
  const titles = new Set();
  let dupes = 0;
  expected.filter((f) => f.endsWith('index.html')).forEach((f) => {
    const page = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = page.match(/<title>([^<]*)<\/title>/);
    if (!m) return fail(f + ' has no title');
    if (titles.has(m[1])) dupes++;
    titles.add(m[1]);
    if (!/rel="canonical"/.test(page)) fail(f + ' has no canonical tag');
    if (page.indexOf('@MAIN@') !== -1 || page.indexOf('@TITLE@') !== -1) fail(f + ' has an unsubstituted placeholder');
  });
  if (dupes) fail(dupes + ' pages share a title with another page');
  else ok('every page has a unique title and a canonical tag');

  const guideIds = Object.keys(data.guides);
  const sample = fs.readFileSync(path.join(ROOT, guideIds[0] + '/index.html'), 'utf8');
  if (!/"@type":\s*"HowTo"/.test(sample)) fail('guide pages have no HowTo structured data');
  else ok('HowTo structured data present');

  const helpPage = fs.readFileSync(path.join(ROOT, 'help/us/index.html'), 'utf8');
  if (helpPage.indexOf('911') === -1) fail('US help page does not show the emergency number');
  else ok('crisis pages carry the emergency number');

  // A parent in Manchester should not be reading about the Irish police, and a
  // parent in Toronto should not be reading about the FBI. The advice is the same
  // everywhere, so it is written without naming anyone's agency. Only the
  // reporting section, the explicit "Sources:" citations, and link URLs may name
  // a national body, and only their own country's.
  const AGENCIES = {
    US: ['NCMEC', 'CyberTipline', 'FBI', 'IC3', 'missingkids'],
    UK: ['CEOP', 'Internet Watch', 'IWF', 'NSPCC', 'Childline', 'National Crime Agency'],
    CA: ['Cybertip', 'NeedHelpNow', 'Canadian Centre'],
    IE: ['Garda', 'Hotline.ie', 'ISPCC', 'Coimisi'],
  };
  let leaks = 0;
  countryIds.forEach((cc) => {
    let page = fs.readFileSync(path.join(ROOT, 'help/' + cc.toLowerCase() + '/index.html'), 'utf8');
    // The reporting section, citation lines and URLs are allowed to name bodies.
    page = page.replace(/href="[^"]*"/g, '');
    page = page.replace(/<p class="tiny">[\s\S]*?<\/p>/g, '');
    const reportStart = page.indexOf('Where to report it');
    const reportEnd = page.indexOf('What has happened?');
    if (reportStart !== -1 && reportEnd > reportStart) {
      page = page.slice(0, reportStart) + page.slice(reportEnd);
    }
    Object.keys(AGENCIES).forEach((owner) => {
      if (owner === cc) return;
      AGENCIES[owner].forEach((token) => {
        if (page.indexOf(token) !== -1) {
          fail('help/' + cc.toLowerCase() + '/ mentions ' + owner + "'s \"" + token + '" outside the reporting section');
          leaks++;
        }
      });
    });
  });
  if (!leaks) ok('no country-specific agency names leak into the shared advice');
}

console.log(
  `\n${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s), ${warnings} warning(s)\n`
);
process.exit(failures ? 1 : 0);
