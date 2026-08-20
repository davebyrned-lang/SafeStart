#!/usr/bin/env node
// Tests the API handlers against a fake Anthropic endpoint, so the parsing, validation
// and streaming paths are covered without spending any credit.
//   node scripts/api-test.js

const path = require('path');
const { PassThrough } = require('stream');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok    ' + name);
  else { failures++; console.error('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

process.env.ANTHROPIC_API_KEY = 'test-key';

const realFetch = global.fetch;
let nextResponse = null;
global.fetch = async () => nextResponse();

function mockRes() {
  const res = new PassThrough();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.body = null;
  res.json = (obj) => { res.body = obj; res.end(); return res; };
  res.collected = '';
  res.on('data', (c) => { res.collected += c.toString(); });
  return res;
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function sseResponse(events) {
  const chunks = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length
          ? { done: false, value: encoder.encode(chunks[i++]) }
          : { done: true, value: undefined }),
      }),
    },
  };
}

(async () => {
  const guideHandler = require(path.join(ROOT, 'api/guide.js'));
  const askHandler = require(path.join(ROOT, 'api/ask.js'));

  console.log('\n/api/guide — happy path');
  const goodGuide = {
    id: 'kahoot', name: 'Kahoot', type: 'app', kind: 'Game',
    blurb: 'Quiz app used in classrooms.', minutes: 6,
    sourceConfidence: 'medium', lastVerified: '2026-08-20',
    risks: ['Nicknames can be inappropriate'],
    beforeYouStart: ['You need a teacher or parent account.'],
    steps: [{
      id: 'names', title: 'Turn on the nickname filter',
      why: 'Stops offensive nicknames appearing on the shared screen.',
      path: 'Settings → Game options',
      do: ['Open settings', 'Toggle the nickname generator on'],
      recommended: { '7-11': 'On', '11-12': 'On', '13-15': 'On', '16-17': 'On' },
    }],
    checklist: ['Nickname filter on'],
    talkAboutIt: ['Ask what they play in class.'],
    links: [{ label: 'Kahoot help (official)', url: 'https://support.kahoot.com/' }],
  };
  nextResponse = () => jsonResponse({
    content: [
      { type: 'text', text: 'I checked the official help centre.\n\n```json\n' + JSON.stringify(goodGuide) + '\n```' },
    ],
    usage: { input_tokens: 10, output_tokens: 20 },
  });

  let res = mockRes();
  await guideHandler({ method: 'GET', query: { app: 'Kahoot', age: '11-12' }, headers: {}, socket: {} }, res);
  check('returns 200', res.statusCode === 200, 'status ' + res.statusCode);
  check('parses the fenced JSON', res.body && res.body.guide && res.body.guide.name === 'Kahoot');
  check('marks the guide as generated', res.body.guide.generated === true);
  check('sets an edge cache header', /s-maxage/.test(res.headers['cache-control'] || ''));

  console.log('\n/api/guide — model returns unusable output');
  nextResponse = () => jsonResponse({ content: [{ type: 'text', text: 'Sorry, I could not find anything.' }] });
  res = mockRes();
  await guideHandler({ method: 'GET', query: { app: 'Nonsense App' }, headers: {}, socket: {} }, res);
  check('returns 502 rather than a broken guide', res.statusCode === 502, 'status ' + res.statusCode);
  check('gives the parent a readable message', typeof res.body.message === 'string' && res.body.message.length > 20);

  console.log('\n/api/guide — steps missing instructions');
  nextResponse = () => jsonResponse({
    content: [{ type: 'text', text: '```json\n' + JSON.stringify({ name: 'X', steps: [{ title: 'Do a thing' }] }) + '\n```' }],
  });
  res = mockRes();
  await guideHandler({ method: 'GET', query: { app: 'Broken App' }, headers: {}, socket: {} }, res);
  check('rejects a guide with empty steps', res.statusCode === 502, 'status ' + res.statusCode);

  console.log('\n/api/guide — curated shortcut');
  nextResponse = () => { throw new Error('should not call the API for a curated guide'); };
  res = mockRes();
  await guideHandler({ method: 'GET', query: { app: 'Roblox' }, headers: {}, socket: {} }, res);
  check('serves Roblox without touching the API', res.statusCode === 200 && res.body.source === 'curated');

  console.log('\n/api/guide — upstream failure');
  nextResponse = () => jsonResponse({ error: { message: 'overloaded' } }, 529);
  res = mockRes();
  await guideHandler({ method: 'GET', query: { app: 'Some New App' }, headers: {}, socket: {} }, res);
  check('returns 502 on an upstream error', res.statusCode === 502, 'status ' + res.statusCode);

  console.log('\n/api/ask — streaming');
  nextResponse = () => sseResponse([
    { type: 'message_start' },
    { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', name: 'web_search' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Open Settings, ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'then Screen Time.' } },
    { type: 'message_stop' },
  ]);
  res = mockRes();
  await askHandler({
    method: 'POST',
    headers: {},
    socket: {},
    body: {
      messages: [{ role: 'user', content: 'Where is the passcode?' }],
      context: { guideId: 'iphone', ageBand: '11–12' },
    },
  }, res);
  check('sets the SSE content type', /text\/event-stream/.test(res.headers['content-type'] || ''));
  check('forwards the search signal', res.collected.includes('"searching"'));
  check('forwards both text chunks', res.collected.includes('Open Settings, ') && res.collected.includes('then Screen Time.'));
  check('sends a done event', res.collected.includes('"done"'));

  console.log('\n/api/ask — validation');
  res = mockRes();
  await askHandler({ method: 'POST', headers: {}, socket: {}, body: { messages: [] } }, res);
  check('rejects an empty conversation', res.statusCode === 400, 'status ' + res.statusCode);

  res = mockRes();
  await askHandler({ method: 'GET', headers: {}, socket: {}, query: {} }, res);
  check('rejects GET', res.statusCode === 405, 'status ' + res.statusCode);

  console.log('\nrate limiting');
  const rl = require(path.join(ROOT, 'api/_lib/ratelimit.js'));
  const fakeReq = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: {} };
  let blocked = false;
  for (let i = 0; i < 12; i++) {
    if (!rl.check(fakeReq, { limit: 8, key: 'test' }).ok) blocked = true;
  }
  check('blocks once over the limit', blocked);
  check('a different visitor is unaffected',
    rl.check({ headers: { 'x-forwarded-for': '5.6.7.8' }, socket: {} }, { limit: 8, key: 'test' }).ok);

  global.fetch = realFetch;
  console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s)\n`);
  process.exit(failures ? 1 : 0);
})();
