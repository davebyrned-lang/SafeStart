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

/* A device can alias another one. A Samsung Galaxy is an Android phone, so
   picking Galaxy has to match every guide written for Android without those
   guides having to list "samsung" as well. A broken alias is invisible in the
   worst way: the parent picks their device and the app list quietly empties. */
data.devices.forEach((d) => {
  if (!d.alias) return;
  if (!deviceIds.includes(d.alias)) fail(`device ${d.id}: alias "${d.alias}" is not a device`);
  if (d.alias === d.id) fail(`device ${d.id}: alias points at itself`);
  const aliased = data.devices.filter((x) => x.id === d.alias)[0];
  if (aliased && aliased.alias) fail(`device ${d.id}: aliases ${d.alias}, which is itself an alias`);
});

/* The version stamp.
 *
 * Every guide carries one shared sentence saying the steps were checked on
 * current software and that menu names move around. It is deliberately vague,
 * and that is a decision worth defending in code rather than in a comment
 * somebody will paint over.
 *
 * A hard version number ("iOS 26", "One UI 7") reads as precision but is a
 * promise with an expiry date. The moment it is wrong it is worse than nothing,
 * because a parent on a newer phone concludes the whole guide is stale and a
 * parent on an older one concludes it was never for them. Neither is true: the
 * settings almost always survive the rename. So the stamp names no version, and
 * this fails the build if one ever creeps in.
 */
if (!data.versionNote || data.versionNote.length < 40) {
  fail('versionNote: missing or too short to be useful');
} else {
  const versionClaim = /\b(iOS|iPadOS|macOS|watchOS|tvOS|Android|One UI|Windows|Fire OS|Chrome ?OS)\s*v?\d/i;
  if (versionClaim.test(data.versionNote)) {
    fail('versionNote: names a specific OS version. It is shown on every guide and cannot be kept true; keep it version-free.');
  }
  if (/\b(19|20)\d{2}\b/.test(data.versionNote)) {
    fail('versionNote: contains a year. The checked-on date sits next to it already.');
  }
}

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

  /* A guide can be built on another one, the way the Samsung guide is built on
     Android. The plan pushes the foundation in ahead of it, so a pointer at a
     guide that is not there would silently drop the foundation and leave a
     parent with the Galaxy-only steps and none of the ones they sit on. */
  if (g.builtOn && !data.guides[g.builtOn]) {
    fail(`${id}: builtOn "${g.builtOn}" is not a guide`);
  }
  if (g.builtOn === id) fail(`${id}: builtOn points at itself`);

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

/* Who holds the setting.
 *
 * The defect this exists to stop: describing a control that lives in the child's
 * own settings as though the parent held it. It got past us on YouTube's
 * autoplay, which YouTube reported, and on Spotify's explicit filter. A sample
 * of fourteen more steps was silent on the question in all fourteen cases, so
 * this is systematic rather than unlucky.
 *
 * Any step with a menu path is a settings step, and every settings step has to
 * answer. The answer is often reassuring, which is the point. */
/* Bullying notes.
 *
 * Two rules, and both exist because the failure mode here is worse than saying
 * nothing. A parent who reads "this setting helps with bullying" and stops
 * reading has been actively misled, because none of these settings stop a
 * classmate being cruel. They change who can reach a child and what gets
 * through, and that is all.
 *
 * So: every bullying note has to name something the setting does not do, and
 * they stay on the handful of steps that genuinely bear on contact. A line on
 * every step would be wallpaper and nobody would read the ones that matter.
 */
/* The installable app.
 *
 * SafeStart ships to the Play Store as a Trusted Web Activity, which is this
 * same site running in a window with no address bar. That means the manifest
 * and the service worker are not a nice-to-have any more: a missing manifest
 * field is a rejected release, and a caching mistake reaches a parent's phone
 * and stays there.
 *
 * The rule worth defending in code is the crisis one. /help/ must never be
 * served from cache while a network exists. Everything else on this site can be
 * a few days stale and a parent is still better off. A stale crisis page sends
 * a frightened person to a reporting route that has moved.
 */
console.log('\ninstallable app');
{
  const manifestPath = path.join(ROOT, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('no manifest.json, so the site is not installable');
  else {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // Play rejects a TWA missing any of these.
    ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']
      .forEach((k) => { if (!m[k]) fail(`manifest.json has no ${k}, which Play requires`); });
    if (m.display !== 'standalone' && m.display !== 'fullscreen') {
      fail(`manifest display is "${m.display}"; a TWA needs standalone`);
    }
    // Declared screenshots have to exist, or Android silently falls back to the
    // plain install prompt and nobody notices the files went missing.
    (m.screenshots || []).forEach((s) => {
      const p = path.join(ROOT, s.src.replace(/^\//, ''));
      if (!fs.existsSync(p)) fail(`manifest names ${s.src} but it is not on disk`);
      if (!s.form_factor) fail(`manifest screenshot ${s.src} has no form_factor`);
    });
    if ((m.screenshots || []).length) ok(`${m.screenshots.length} install-prompt screenshots, all present`);

    if ((m.short_name || '').length > 12) {
      fail(`short_name "${m.short_name}" is over 12 characters and gets truncated under the icon`);
    }
    const icons = m.icons || [];
    const has = (size, purpose) => icons.some(
      (i) => i.sizes === size + 'x' + size && (i.purpose || 'any').split(' ').includes(purpose)
    );
    if (!has(192, 'any')) fail('manifest has no 192px icon');
    if (!has(512, 'any')) fail('manifest has no 512px icon');
    // Without a maskable icon Android pads the square one inside a white circle,
    // which looks like a mistake on every launcher that uses a round mask.
    if (!has(512, 'maskable')) fail('manifest has no maskable icon, so Android will letterbox it');
    icons.forEach((i) => {
      const f = path.join(ROOT, i.src.replace(/^\//, ''));
      if (!fs.existsSync(f)) fail(`manifest points at ${i.src}, which is not in the build`);
    });
    ok(`manifest.json complete, ${icons.length} icons, all present`);
  }

  const swPath = path.join(ROOT, 'sw.js');
  if (!fs.existsSync(swPath)) fail('no sw.js, so there is no offline support');
  else {
    const sw = fs.readFileSync(swPath, 'utf8');
    if (sw.includes('@CACHE_VERSION@')) {
      fail('sw.js still has the @CACHE_VERSION@ placeholder, so every deploy reuses one cache');
    } else if (!/var VERSION = "[0-9a-f]{12}"/.test(sw)) {
      fail('sw.js has no content fingerprint, so an old cache is never invalidated');
    } else ok('sw.js carries a content fingerprint, so a change invalidates the old cache');

    // The rule. Written as a check rather than a comment because a future
    // "make it faster" change is exactly how this gets broken.
    if (!/isCrisis/.test(sw)) fail('sw.js no longer knows what a crisis page is');
    if (/caches\.match\(req\)[\s\S]{0,120}\|\|[\s\S]{0,40}fetch/.test(
      sw.slice(sw.indexOf('Network-first'))
    )) {
      fail('sw.js looks like it serves pages cache-first, which would let /help/ go stale');
    }
    if (!/\/api\\\//.test(sw) && !sw.includes('/^\\/api\\//')) {
      warn('sw.js may no longer exclude /api/ from caching');
    } else ok('the API is excluded from caching');
    ok('the crisis pages are network-first, so they cannot be served stale online');
  }

  const alPath = path.join(ROOT, '.well-known', 'assetlinks.json');
  if (!fs.existsSync(alPath)) {
    fail('no .well-known/assetlinks.json, so the Android app would show an address bar');
  } else {
    const al = JSON.parse(fs.readFileSync(alPath, 'utf8'));
    const t = (al[0] || {}).target || {};
    if (!t.package_name) fail('assetlinks.json has no package_name');
    const fps = t.sha256_cert_fingerprints || [];
    if (!fps.length) fail('assetlinks.json lists no signing fingerprints');
    else if (fps.some((f) => /REPLACE|PLACEHOLDER|XX:XX/i.test(f))) {
      warn('assetlinks.json still holds a placeholder fingerprint. The app will show an address bar until the real one from the Play Console goes in.');
    } else {
      /* Two fingerprints, not one.
       *
       * Play strips the upload signature and re-signs every release with a key
       * Google holds, so the signature reaching a parent's phone is Google's,
       * not ours. Listing only one of the two is the commonest Trusted Web
       * Activity mistake there is, and it fails in the worst way: the app works
       * perfectly on the machine that built it, and opens with a Chrome address
       * bar on every phone that installed it from the store. */
      const BAD = fps.filter((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
      if (BAD.length) fail(`assetlinks.json has ${BAD.length} malformed fingerprint(s); Play prints them as 32 colon-separated uppercase hex pairs`);
      else if (new Set(fps).size !== fps.length) fail('assetlinks.json lists the same fingerprint twice');
      else if (fps.length < 2) {
        fail('assetlinks.json has only the upload key. Play re-signs every release with its own key, so the store build will show an address bar until that fingerprint is here too (Protected with Play, Play Store protection, Play app signing).');
      } else ok(`assetlinks.json carries ${fps.length} well-formed fingerprints, upload key and Play's`);
    }
  }
}

console.log('\nbullying notes');
{
  const LIMIT_WORDS = /\bdoes not\b|\bdo not\b|\bcannot\b|\bnot\b|\bnothing\b|\bgone\b|\bless\b|\brather than\b|\bgets around\b|\bonly\b/i;
  const withNote = [];
  const noLimit = [];
  Object.entries(data.guides).forEach(([id, g]) => {
    (g.steps || []).forEach((s) => {
      if (!s.bullying) return;
      withNote.push(id + '/' + s.id);
      if (s.bullying.length < 60) fail(`${id}/${s.id}: bullying note is too short to say anything useful`);
      if (!LIMIT_WORDS.test(s.bullying)) noLimit.push(id + '/' + s.id);
    });
  });
  if (!withNote.length) fail('no bullying notes anywhere, so the guides say nothing about it');
  if (noLimit.length) {
    fail('bullying note(s) that only say what a setting helps with, and never what it misses: ' + noLimit.join(', '));
  } else {
    ok(`${withNote.length} bullying notes, every one naming a limit`);
  }
  // Wallpaper check. If this ever fires it means someone started adding them
  // everywhere, at which point a parent stops seeing them at all.
  const total = Object.values(data.guides).reduce((n, g) => n + (g.steps || []).length, 0);
  if (withNote.length > total * 0.25) {
    fail(`${withNote.length} of ${total} steps carry a bullying note. Past about a quarter they stop being read.`);
  } else {
    ok(`on ${withNote.length} of ${total} steps, which is few enough to be noticed`);
  }
  // The crisis page is the main route and has to keep the capture advice.
  // safeguarding.json is loaded properly further down; this block runs first,
  // so it reads its own copy rather than reordering the file.
  const sgEarly = JSON.parse(fs.readFileSync(path.join(ROOT, 'safeguarding.json'), 'utf8'));
  const bully = (sgEarly.situations || []).find((x) => x.id === 'bullying');
  if (!bully) fail('no bullying situation on the crisis page');
  else if (!(bully.keyAdvice || []).some((a) => /before you block/i.test(a.title))) {
    fail('the bullying situation no longer tells a parent to save evidence before blocking');
  } else ok('the crisis page still leads with saving evidence before blocking');
}

console.log('\nwho holds the setting');
{
  const vocab = Object.keys(data.heldBy || {});
  if (!vocab.length) fail('no heldBy vocabulary in guides.json');
  const counts = {};
  const missing = [];
  Object.entries(data.guides).forEach(([id, g]) => {
    (g.steps || []).forEach((s) => {
      if (s.heldBy && !vocab.includes(s.heldBy)) {
        fail(`${id}/${s.id}: heldBy "${s.heldBy}" is not in the vocabulary`);
      }
      // The age-banded form, for the settings that change hands at a birthday.
      Object.entries(s.heldByAge || {}).forEach(([band, v]) => {
        if (!bandIds.includes(band)) fail(`${id}/${s.id}: heldByAge has unknown band "${band}"`);
        if (!vocab.includes(v)) fail(`${id}/${s.id}: heldByAge "${v}" is not in the vocabulary`);
      });
      if (!s.path) return;                       // not a settings step
      const answer = s.heldBy || (s.heldByAge && Object.values(s.heldByAge)[0]);
      if (!answer) { missing.push(`${id}/${s.id}`); return; }
      // A step that changes hands must say so for every age it is shown to.
      if (s.heldByAge && !s.heldBy) {
        const need = (s.ages && s.ages.length ? s.ages : bandIds)
          .filter((a) => parseInt(a, 10) >= (g.minAge || 0));
        need.forEach((a) => {
          if (!s.heldByAge[a]) fail(`${id}/${s.id}: heldByAge says nothing for ages ${a}`);
        });
      }
      counts[answer] = (counts[answer] || 0) + 1;
    });
  });
  if (missing.length) {
    fail(`${missing.length} settings step(s) do not say who holds them:`);
    missing.forEach((m) => console.error(`          ${m}`));
  } else {
    ok(Object.keys(counts).sort().map((k) => `${counts[k]} ${k}`).join(', '));
    ok('every settings step says whether the child can reverse it');
  }
}

/* Adding a guide with a new kind silently falls back to the generic shield,
 * which looks like a bug and nobody notices until a screenshot. Spotify shipped
 * with one for about ten minutes. */
console.log('\nkind icons');
{
  const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
  const map = appSrc.match(/var KIND_ICON\s*=\s*\{([\s\S]*?)\}/);
  if (!map) fail('cannot find KIND_ICON in src/app.html');
  else {
    const named = new Set([...map[1].matchAll(/["']?([\w ]+)["']?\s*:/g)].map((m) => m[1].trim()));
    const kinds = [...new Set(Object.values(data.guides).map((g) => g.kind))];
    kinds.forEach((k) => {
      if (!named.has(k)) fail(`kind "${k}" has no icon, so it falls back to the generic shield`);
    });
    ok(`${kinds.length} kinds, every one with its own icon`);
  }

  /* Device guides fall back to the generic monitor when they have no icon of
     their own, which is how the Samsung guide first shipped a desktop monitor
     next to "Samsung Galaxy phone or tablet". It renders, so nothing complains,
     and a parent scanning the list reads the wrong picture. */
  const guideMap = appSrc.match(/var GUIDE_ICON\s*=\s*\{([\s\S]*?)\}/);
  if (!guideMap) fail('cannot find GUIDE_ICON in src/app.html');
  else {
    const iconed = new Set([...guideMap[1].matchAll(/["']?([\w]+)["']?\s*:/g)].map((m) => m[1]));
    const bare = Object.keys(data.guides).filter((id) => data.guides[id].type === 'device' && !iconed.has(id));
    if (bare.length) fail(`device guide(s) with no icon of their own, so they show the generic monitor: ${bare.join(', ')}`);
    else ok('every device guide has its own icon');
  }
}

/* Fixing a bad setup.
 *
 * Two rules here, and both exist because this content is more dangerous than
 * the rest of the site. A one-way warning that reads like ordinary advice will
 * get skimmed, and an undo note that quietly guesses will get a child's account
 * deleted. So: every platform we know has an irreversible step must carry a
 * oneWay entry, and anything we could not confirm has to say so in the text
 * rather than sound certain. */
console.log('\nfixing a bad setup');
const MUST_WARN = ['playstation', 'switch', 'tiktok', 'firetablet', 'iphone', 'ipad', 'android'];
MUST_WARN.forEach((id) => {
  const g = data.guides[id];
  if (!g) { fail(`${id}: guide missing, but it is on the one-way warning list`); return; }
  if (!Array.isArray(g.oneWay) || !g.oneWay.length) {
    fail(`${id}: has an irreversible step and must carry a oneWay warning`);
  }
});

let undoCount = 0;
let oneWayCount = 0;
const HEDGES = /could not confirm|we could not|our reading|does not state|cannot confirm/i;
Object.keys(data.guides).forEach((id) => {
  const g = data.guides[id];
  (g.oneWay || []).forEach((t) => {
    oneWayCount++;
    if (t.length < 40) fail(`${id}: oneWay entry is too short to be a real warning`);
  });
  if (g.oneWay && !Array.isArray(g.oneWay)) fail(`${id}: oneWay must be an array`);
  (g.steps || []).forEach((s) => {
    if (!s.undo) return;
    undoCount++;
    if (typeof s.undo !== 'string' || s.undo.length < 40) {
      fail(`${id}/${s.id}: undo note is too short to be useful`);
    }
  });
});
ok(`${undoCount} undo notes and ${oneWayCount} one-way warnings`);

/* The four things we could not verify against an official page. If any of these
 * ever reads as a flat statement of fact, someone has edited out the hedge and
 * the guide is now asserting something no source backs. */
[
  ['xbox', 'content'],       // Xbox PIN reset, script-loaded page we cannot read
  ['instagram', 'birthday'], // how many birthday changes Instagram allows
  ['whatsapp', 'managed'],   // whether an existing account can be converted
  ['iphone', 'passcode'],    // Screen Time passcode reset on a Mac
].forEach(([id, stepId]) => {
  const s = (data.guides[id]?.steps || []).filter((x) => x.id === stepId)[0];
  if (!s || !s.undo) { fail(`${id}/${stepId}: expected an undo note here`); return; }
  if (!HEDGES.test(s.undo)) {
    fail(`${id}/${stepId}: this one is unverified and the note must say so, not assert it`);
  }
});
ok('every unverified claim still says it is unverified');

// Exactly one "start here" guide, and it must lead every plan.
const starts = Object.keys(data.guides).filter((id) => data.guides[id].type === 'start');
if (starts.length !== 1) fail(`expected exactly one start guide, found ${starts.length}`);
else if (data.guides[starts[0]].priority !== 0) fail(`${starts[0]}: start guide must be priority 0`);
else ok(`start guide is ${starts[0]}`);

// The whole point of the shared vocabulary is that it is shared. If two apps can
// drift to different sentences for the same thing, it has stopped working.
console.log('\nplain-English outcomes');
const OUTCOME_KEYS = Object.keys(data.outcomes || {});
if (!OUTCOME_KEYS.length) fail('guides.json has no outcomes vocabulary');
let mapped = 0;
Object.keys(data.guides).forEach((id) => {
  (data.guides[id].steps || []).forEach((s) => {
    if (!s.outcomeByAge) return;
    mapped++;
    Object.keys(s.outcomeByAge).forEach((band) => {
      if (!bandIds.includes(band)) fail(`${id}/${s.id}: outcomeByAge has unknown band "${band}"`);
      if (!OUTCOME_KEYS.includes(s.outcomeByAge[band])) {
        fail(`${id}/${s.id}: outcome "${s.outcomeByAge[band]}" is not in the shared vocabulary`);
      }
    });
    // A recommendation the parent reads with no plain-English twin is the exact
    // problem this was built to solve, so the two have to stay in step.
    if (s.recommended) {
      Object.keys(s.recommended).forEach((band) => {
        if (!s.outcomeByAge[band]) fail(`${id}/${s.id}: recommends something for ${band} with no plain-English outcome`);
      });
    }
  });
});
ok(`${mapped} settings carry a shared plain-English outcome, from ${OUTCOME_KEYS.length} phrasings`);

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
if (!/name="google-site-verification"/.test(html)) {
  fail('the Google Search Console verification tag is missing from the template');
} else ok('carries the Search Console verification tag');
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
if (noMins.length) fail(noMins.length + ' steps have no minute estimate, so parts cannot be sized');
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
                  'changelog/index.html', 'plan/index.html', 'about/index.html',
                  'feedback/index.html', 'privacy/index.html']
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

/* Contrast, in both themes.
 *
 * The palette is warm now, and warm palettes are easy to drift into unreadable:
 * a clay that looks lovely as a border fails as text, and nobody notices until a
 * parent with older eyes cannot read a warning. So the tokens are parsed straight
 * out of the stylesheet and every pair that ends up as text somewhere is checked
 * against WCAG AA. Change a colour and this tells you before a reader does.
 */
console.log('\ncolour contrast');
{
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');

  const block = (sel) => {
    const m = app.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}'));
    if (!m) return null;
    const out = {};
    m[1].replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (_, k, v) => { out[k] = v.trim(); return ''; });
    return out;
  };
  const light = block(':root');
  const dark = block(':root[data-theme="dark"]');
  if (!light || !dark) { fail('cannot parse the palette out of src/app.html'); }
  else {
    // Resolve one level of var() indirection, which is how the voices are defined.
    const val = (vars, name, seen = 0) => {
      let v = vars[name];
      if (!v && vars !== light) v = light[name];
      if (!v || seen > 4) return v;
      const ref = v.match(/^var\((--[\w-]+)\)$/);
      return ref ? val(vars, ref[1], seen + 1) : v;
    };
    const lum = (hex) => {
      const h = (hex || '').trim().replace('#', '');
      if (!/^[0-9a-f]{6}$/i.test(h)) return null;
      const c = h.match(/../g).map((x) => {
        const n = parseInt(x, 16) / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)];
      if (x === null || y === null) return null;
      const [hi, lo] = [x, y].sort((m, n) => n - m);
      return (hi + 0.05) / (lo + 0.05);
    };

    // [label, foreground token, background token, minimum]
    const PAIRS = [
      ['body on a card', '--body', '--surface', 4.5],
      ['heading on a card', '--heading', '--surface', 4.5],
      ['muted on a card', '--muted', '--surface', 4.5],
      ['muted on the ground', '--muted', '--bg', 4.5],
      ['a link', '--action', '--paper', 4.5],
      ['a button label', '--on-action', '--action', 4.5],
      ['caution as text', '--caution', '--paper', 4.5],
      ['info as text', '--info', '--paper', 4.5],
      ['text on the sun fill', '--on-fill', '--fill-sun', 4.5],
      ['text on the warm fill', '--on-fill', '--fill-warm', 4.5],
      ['caution on its tint', '--caution', '--caution-tint', 4.5],
      ['info on its tint', '--info', '--info-tint', 4.5],
    ];
    let worst = { r: Infinity };
    [['light', light], ['dark', dark]].forEach(([theme, vars]) => {
      PAIRS.forEach(([label, fg, bg, min]) => {
        const a = val(vars, fg), b = val(vars, bg);
        const r = ratio(a, b);
        if (r === null) { fail(`${theme}: cannot resolve ${fg} on ${bg} (${a} / ${b})`); return; }
        if (r < min) fail(`${theme}: ${label} is ${r.toFixed(2)}:1, AA needs ${min}`);
        if (r < worst.r) worst = { r, label, theme };
      });
    });
    if (worst.r < Infinity) {
      ok(`${PAIRS.length * 2} pairs across both themes, tightest is ${worst.label} in ${worst.theme} at ${worst.r.toFixed(2)}:1`);
    }
  }
}

/* The privacy policy.
 *
 * Play will not accept a listing without a live privacy policy URL, and it
 * rechecks it. A 404 there is not a broken link, it is a suspended app, and it
 * would break silently because nothing else on the site links to that page from
 * a path a reader is likely to walk.
 *
 * The page also has to stay true. Every claim on it maps to something in this
 * repo, so the two things most likely to falsify it are checked here: that the
 * page counter really is kept off /plan/, and that the page has not started
 * promising there is no analytics at all.
 */
console.log('\nprivacy policy');
{
  const privPath = path.join(ROOT, 'privacy', 'index.html');
  if (!fs.existsSync(privPath)) {
    fail('no privacy/index.html; Play suspends a listing whose policy URL 404s');
  } else {
    const html = fs.readFileSync(privPath, 'utf8');

    // The page has to be reachable without knowing the URL, or nobody but Play
    // ever sees it.
    const foot = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
    if (!/href="\/privacy\/"/.test(foot)) {
      fail('src/app.html does not link to /privacy/, so only Play would ever find it');
    } else ok('linked from the footer on every page');

    const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    if (sitemap.indexOf('/privacy/') === -1) fail('/privacy/ is missing from sitemap.xml');
    else ok('in the sitemap');

    // The strongest claim on the page. If someone drops noAnalytics from the
    // plan route, the policy becomes a false statement rather than a stale one.
    const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    const planBlock = build.slice(build.indexOf('url: "/plan/"'), build.indexOf('url: "/plan/"') + 600);
    if (!/noAnalytics:\s*true/.test(planBlock)) {
      fail('/plan/ no longer sets noAnalytics, and /privacy/ tells parents it does');
    } else ok('the plan page is still excluded from the counter, as the policy says');

    const planHtml = path.join(ROOT, 'plan', 'index.html');
    if (fs.existsSync(planHtml) && /_vercel\/insights/.test(fs.readFileSync(planHtml, 'utf8'))) {
      fail('the built plan page carries the analytics script; the policy says it does not');
    }

    // Named processors. If a fourth one is added the page needs to say so.
    ['Vercel', 'Anthropic', 'Resend'].forEach((p) => {
      if (html.indexOf(p) === -1) fail(`/privacy/ no longer names ${p} as a processor`);
    });

    // GDPR wants the controller identified by more than an email box, and Play's
    // reviewers look for a real entity behind the policy.
    if (!/mailto:/.test(html)) fail('/privacy/ has no contact address, which GDPR requires');
    else if (!/Alexandria/.test(html)) fail('/privacy/ no longer names the controller postal address');
    else ok('names the controller, a postal address, a contact address and all three processors');

    if (!/Updated \d/.test(html)) warn('/privacy/ shows no updated date');
  }
}

console.log(
  `\n${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s), ${warnings} warning(s)\n`
);
process.exit(failures ? 1 : 0);
