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
    // Below 560px the crisis link takes the width and the byline drops out. TrustRaise
    // still has the footer, which is where the attribution belongs anyway.
    check('byline hidden on a narrow screen', !(await page.locator('.by-line').first().isVisible()));
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(120);
    check('TrustRaise byline in the header on a wide screen',
      await page.locator('.by-line img').first().isVisible());
    await page.setViewportSize({ width: 420, height: 900 });
    await page.waitForTimeout(120);
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
    // rel=canonical and rel=alternate are metadata for crawlers, not resources the
    // browser fetches, so they don't count as a third-party request.
    const external = await page.evaluate(() =>
      [...document.querySelectorAll('link[href^="http"], script[src^="http"]')]
        .filter((n) => !['canonical', 'alternate'].includes((n.getAttribute('rel') || '').toLowerCase()))
        .map((n) => n.href || n.src));
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

    // --- phase one: real URLs, no-JS resilience, country, crisis route --------

    console.log('\nprerendered guide URLs');
    await page.goto(BASE + '/roblox/', { waitUntil: 'networkidle' });
    check('/roblox/ resolves', (await page.locator('.guide-title').textContent()).includes('Roblox'));
    const robloxTitle = await page.title();
    check('guide page has its own title', /Roblox/i.test(robloxTitle), robloxTitle);
    const canon = await page.locator('link[rel=canonical]').getAttribute('href');
    check('canonical points at the guide', /\/roblox\/$/.test(canon), canon);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    check('HowTo structured data is valid JSON', JSON.parse(ld)['@type'] === 'HowTo');
    check('fonts load on a nested URL',
      await page.evaluate(() => document.fonts.check('600 16px Inter')));

    console.log('\nworks without javascript');
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJs.newPage();
    await noJsPage.goto(BASE + '/roblox/');
    const noJsText = await noJsPage.locator('#app').textContent();
    check('guide content is in the HTML', noJsText.includes('Parent PIN'), noJsText.slice(0, 80));
    check('steps render without JS', (await noJsPage.locator('.step').count()) >= 5);

    await noJsPage.goto(BASE + '/help/uk/');
    const helpText = await noJsPage.locator('#app').textContent();
    check('UK crisis page renders without JS', helpText.includes('999'));
    check('UK page shows UK bodies', /CEOP|Internet Watch/.test(helpText));
    check('UK page does not show US bodies', !/CyberTipline/.test(helpText));
    await noJsPage.goto(BASE + '/help/us/');
    const usText = await noJsPage.locator('#app').textContent();
    check('US crisis page shows US bodies', /CyberTipline/.test(usText));
    check('crisis page leads with the emergency number',
      (await noJsPage.locator('.emergency').first().textContent()).includes('911'));
    check('do-not-pay guidance present', /do not pay|never pay|Do not pay/i.test(usText));
    check('do-not-delete guidance present', /do not delete|Do not delete/i.test(usText));
    await noJs.close();

    console.log('\ncountry and currency');
    await page.goto(BASE + '/roblox/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.rec');
    const usSpend = await page.locator('.step', { hasText: 'Robux' }).locator('.rec').textContent();
    check('currency renders as a single symbol', !/£.*\$|\$.*£/.test(usSpend), usSpend.slice(0, 60));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#countrySel');
    await page.selectOption('#countrySel', 'UK');
    await page.locator('.card', { hasText: 'Roblox' }).first().click();
    await page.waitForSelector('.rec');
    const ukSpend = await page.locator('.step', { hasText: 'Robux' }).locator('.rec').textContent();
    check('UK sees pounds', ukSpend.includes('£'), ukSpend.slice(0, 60));
    check('UK does not also see dollars', !ukSpend.includes('$0'), ukSpend.slice(0, 60));

    console.log('\ncrisis route');
    check('every guide ends with a route to help',
      await page.locator('.help-card').isVisible());
    check('header carries the crisis link',
      (await page.locator('.help-btn').getAttribute('href')) === '/help/');
    await page.locator('#askFab').click();
    await page.fill('#chatInput', 'a grown man has been messaging my daughter on roblox');
    await page.locator('#chatSend').click();
    await page.waitForTimeout(400);
    check('chat surfaces the crisis route immediately',
      await page.locator('.chat-help').isVisible());
    check('crisis card names the emergency number',
      (await page.locator('.chat-help').textContent()).includes('999'));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#askFab, .card');

    console.log('\nrobots and sitemap');
    const sm = await page.request.get(BASE + '/sitemap.xml');
    check('sitemap serves', sm.status() === 200, 'status ' + sm.status());
    const smBody = await sm.text();
    check('sitemap lists every guide', (smBody.match(/<url>/g) || []).length >= 22);
    const rb = await page.request.get(BASE + '/robots.txt');
    check('robots.txt serves', rb.status() === 200, 'status ' + rb.status());
    check('robots points at the sitemap', (await rb.text()).includes('sitemap.xml'));

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
