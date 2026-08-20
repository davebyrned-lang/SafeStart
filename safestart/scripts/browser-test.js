#!/usr/bin/env node
// Headless smoke test. Boots the dev server, drives the real UI, fails on any console error.
//   node scripts/browser-test.js

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3777;
const BASE = `http://localhost:${PORT}`;
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log('  ok    ' + name);
  else { failures++; console.error('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const server = spawn('node', [path.join(__dirname, 'dev-server.js')], {
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r) => setTimeout(r, 900));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  try {
    console.log('\nhome');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card-grid .card');
    const cards = await page.locator('.card').count();
    check(`${cards} guide cards render`, cards >= 17, `saw ${cards}`);
    check('hero copy present', (await page.locator('h1').first().textContent()).length > 10);
    check('three picker steps', (await page.locator('.pick').count()) === 3);
    check('every tile has an icon', (await page.locator('.card .card-ico svg').count()) === cards);

    console.log('\nbranding');
    check('TrustRaise byline in the header', await page.locator('.by-line img').first().isVisible());
    const footer = await page.locator('.site-foot').textContent();
    check('footer names TrustRaise', footer.includes('TrustRaise'));
    check('footer carries the tagline', footer.includes('Building Trust. Driving Revenue. Scaling Responsibly.'));
    const logoResp = await page.request.get(BASE + '/assets/trustraise-logo.png');
    check('logo asset serves', logoResp.status() === 200, 'status ' + logoResp.status());
    const blue = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--blue').trim());
    check('TrustRaise Blue is the primary', blue.toUpperCase() === '#1F3FE2', blue);
    const fontResp = await page.request.get(BASE + '/assets/fonts/inter-600.woff2');
    check('Inter is self-hosted', fontResp.status() === 200, 'status ' + fontResp.status());
    check('Inter actually renders',
      await page.evaluate(() => document.fonts.check('600 16px Inter')));
    const external = await page.evaluate(() =>
      [...document.querySelectorAll('link[href^="http"], script[src^="http"]')].map((n) => n.href || n.src));
    check('no third-party requests', external.length === 0, external.join(' | '));

    console.log('\npicker flow');
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForSelector('.device-cta');
    check('device selection offers the device guide', await page.locator('.device-cta').isVisible());
    const appsForIphone = await page.locator('.pick').nth(2).locator('.card').count();
    check('app tiles filter to the chosen device', appsForIphone > 0 && appsForIphone <= 8, `saw ${appsForIphone}`);
    await page.locator('.pick-note button').first().click();
    await page.waitForTimeout(150);
    check('skip clears the device', (await page.locator('.device-cta').count()) === 0);

    console.log('\nsearch');
    await page.fill('#homeSearch', 'rob');
    await page.waitForSelector('.search-hit');
    check('search finds Roblox', (await page.locator('.search-hit .hit-name').first().textContent()).includes('Roblox'));
    await page.fill('#homeSearch', 'kahootzzz');
    await page.waitForSelector('.search-hit.is-new');
    check('unknown app offers a live lookup', await page.locator('.search-hit.is-new').isVisible());
    await page.fill('#homeSearch', '');

    console.log('\nguide — roblox');
    await page.locator('.card', { hasText: 'Roblox' }).first().click();
    await page.waitForSelector('.step');
    const stepsAll = await page.locator('.step').count();
    check(`${stepsAll} steps render`, stepsAll >= 5, `saw ${stepsAll}`);
    check('age nudge shown before an age is picked', await page.locator('.age-nudge').isVisible());
    check('recommendation table shown before an age is picked', await page.locator('.rec-table').first().isVisible());

    console.log('\nage tailoring');
    await page.locator('.chip', { hasText: '7–11' }).first().click();
    await page.waitForSelector('.profile-card');
    check('profile card appears', (await page.locator('.profile-card h3').textContent()).includes('Maximum Protection'));
    const steps711 = await page.locator('.step').count();
    check('age filtering changes the step list', steps711 <= stepsAll, `${steps711} vs ${stepsAll}`);
    const recText = await page.locator('.rec').first().textContent();
    check('single recommendation shown for the chosen age', recText.includes('Minimal'), recText.slice(0, 80));
    check('url carries the age', page.url().includes('age=7-11'));
    check('controls collapse once the age is known', await page.locator('.ctl-summary').isVisible());
    check('summary shows the answers', (await page.locator('.ctl-summary').textContent()).includes('7–11'));

    console.log('\nhelp modes');
    check('quick mode hides the why', (await page.locator('.why').count()) === 0);
    await page.locator('.ctl-summary').click();
    await page.waitForSelector('.controls:not(.collapsed)');
    check('controls reopen on Change', (await page.locator('.ctl-label').count()) > 0);
    await page.locator('.chip', { hasText: 'Learn as we go' }).first().click();
    await page.waitForTimeout(150);
    check('learn mode shows the why', (await page.locator('.why').count()) > 0);

    console.log('\nprogress');
    await page.locator('.check-item').first().click();
    await page.waitForTimeout(120);
    check('checklist item toggles on', await page.locator('.check-item.on').first().isVisible());
    await page.locator('.step-done-btn').first().click();
    await page.waitForTimeout(120);
    check('step marks as done', await page.locator('.step.done').first().isVisible());

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.step');
    check('progress survives a reload', await page.locator('.check-item.on').first().isVisible());
    check('age survives a reload', await page.locator('.profile-card').isVisible());

    console.log('\nunder-age notice');
    await page.goto(BASE + '/?guide=tiktok&age=7-11', { waitUntil: 'networkidle' });
    await page.waitForSelector('.step');
    const nudges = await page.locator('.age-nudge').allTextContents();
    check('minimum age flagged on TikTok for 7–11', nudges.some((t) => t.includes('minimum age')), nudges.join(' | '));

    console.log('\ndevice guide');
    await page.goto(BASE + '/?guide=iphone&age=11-12', { waitUntil: 'networkidle' });
    await page.waitForSelector('.step');
    check('iPhone guide renders', (await page.locator('h1').nth(0).textContent()).includes('iPhone'));
    check('no device chip row on a device guide', (await page.locator('.ctl-label', { hasText: 'Where they use it' }).count()) === 0);

    console.log('\nchat');
    await page.locator('#askFab').click();
    await page.waitForTimeout(350);
    check('chat panel opens', await page.locator('#chatPanel').isVisible());
    check('chat shows the context line', (await page.locator('#chatCtx').textContent()).includes('iPhone'));
    check('suggestions render', (await page.locator('#chatSuggest button').count()) > 0);
    await page.fill('#chatInput', 'Where is the Screen Time passcode?');
    await page.locator('#chatSend').click();
    await page.waitForTimeout(1200);
    const chatText = await page.locator('#chatLog').textContent();
    check('graceful message when the API key is absent', /switched on|wrong|again/i.test(chatText), chatText.slice(-160));

    console.log('\napi without a key');
    const r = await page.request.get(BASE + '/api/guide?app=kahoot');
    check('/api/guide returns 503 with no key', r.status() === 503, 'status ' + r.status());
    const rc = await page.request.get(BASE + '/api/guide?app=roblox');
    check('/api/guide serves curated guides for free', rc.status() === 200, 'status ' + rc.status());
    const rj = await rc.json();
    check('curated response is marked as curated', rj.source === 'curated');

    console.log('\nconsole');
    // The chat test above deliberately runs with no API key, so a 503 on /api/ask is
    // expected. Anything else is a real bug.
    const realErrors = consoleErrors.filter(
      (t) => !/Failed to load resource.*503/.test(t)
    );
    check('no unexpected console errors', realErrors.length === 0, realErrors.join(' | '));
  } catch (err) {
    failures++;
    console.error('\n  FAIL  test threw: ' + err.message);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${failures} failure(s)\n`);
  process.exit(failures ? 1 : 0);
})();
