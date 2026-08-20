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
  if (!['app', 'device'].includes(g.type)) fail(`${id}: type is "${g.type}"`);
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

console.log('\nindex.html');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (!/fetch\("guides\.json"\)/.test(html)) fail('index.html does not fetch guides.json');
else ok('fetches guides.json');
if (!/\/api\/guide\?/.test(html)) fail('index.html does not call /api/guide');
else ok('calls /api/guide');
if (!/\/api\/ask/.test(html)) fail('index.html does not call /api/ask');
else ok('calls /api/ask');

console.log(
  `\n${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s), ${warnings} warning(s)\n`
);
process.exit(failures ? 1 : 0);
