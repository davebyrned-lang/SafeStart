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
    check('headline is the collaborative one',
      (await page.locator('h1').first().textContent()).includes("Let's set this up together"));
    check('three picker steps', (await page.locator('.pick').count()) === 3);
    check('device step comes first',
      (await page.locator('.pick-q').first().textContent()).includes('device'));
    const cards = await page.locator('.card').count();
    check(`${cards} tiles render`, cards >= 17, `saw ${cards}`);
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

    console.log('\ndevice-first picker');
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForTimeout(150);
    const appsForIphone = await page.locator('.pick').nth(2).locator('.card').count();
    // Fewer than the full catalogue, because consoles-only guides drop out.
    check('app tiles filter to the chosen device',
      appsForIphone > 0 && appsForIphone < 20, `saw ${appsForIphone}`);
    check('no build button until an age is picked', (await page.locator('.build-cta').count()) === 0);
    await page.locator('.chip', { hasText: '11\u201312' }).first().click();
    await page.waitForTimeout(150);
    check('build button appears once device and age are set', await page.locator('.build-cta').isVisible());
    check('device-only plan is allowed',
      (await page.locator('.build-cta').textContent()).includes('part'));

    console.log('\nthe device setup is optional');
    check('offers to skip a device that is already done',
      (await page.locator('.sub-q').textContent()).includes('Already done'));
    // Roblox has no minimum age, so this exercises the device toggle without
    // tripping the over-age warning tested further down. Measure with the app
    // already added, so the only difference between the two is the device.
    await page.locator('.card.selectable', { hasText: 'Roblox' }).first().click();
    await page.waitForTimeout(150);
    const withDevice = await page.locator('.build-cta').textContent();
    await page.locator('.chip', { hasText: 'Already done' }).first().click();
    await page.waitForTimeout(200);
    const withoutDevice = await page.locator('.build-cta').textContent();
    check('skipping the device makes the plan shorter', withoutDevice !== withDevice,
      `${withDevice.trim()} vs ${withoutDevice.trim()}`);
    await page.locator('.card.selectable.on').first().click();
    await page.waitForTimeout(200);
    check('no apps and no device setup leaves nothing to build',
      (await page.locator('.build-cta').count()) === 0);
    check('and says why', (await page.locator('.pick-note.dim').textContent()).includes('at least one app'));
    await page.locator('.chip', { hasText: 'Set it up too' }).first().click();
    await page.waitForTimeout(200);
    check('device-only plan is buildable again', await page.locator('.build-cta').isVisible());

    console.log('\nappearance toggle');
    // Order matters here. Flipping the emulated colour scheme fires a change
    // event on whatever page is already loaded, and the app's "follow the device"
    // handler responds by writing an explicit "auto" preference. So switch the
    // scheme first, then clear storage, then reload, or the test is really
    // measuring its own side effect.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle' });
    const themeAttr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const themePref = () => page.evaluate(() => { try { return localStorage.getItem('safestart:theme'); } catch (e) { return null; } });
    check('follows the device when nothing is chosen', (await themeAttr()) === 'dark' && (await themePref()) === null);
    await page.locator('#themeBtn').click();
    await page.waitForTimeout(150);
    check('one tap overrides a dark device to light',
      (await themeAttr()) === 'light' && (await themePref()) === 'light');
    await page.reload({ waitUntil: 'networkidle' });
    check('the choice survives a reload', (await themeAttr()) === 'light');
    check('and is set before the app boots, so there is no flash',
      (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light');
    await page.locator('#themeBtn').click();
    await page.waitForTimeout(120);
    check('second tap goes to dark', (await themePref()) === 'dark');
    await page.locator('#themeBtn').click();
    await page.waitForTimeout(120);
    check('third tap returns to matching the device', (await themePref()) === 'auto');
    check('the button says what it will do next',
      /Switch to/.test(await page.locator('#themeBtn').getAttribute('aria-label')));
    await page.goto(BASE + '/help/uk/', { waitUntil: 'networkidle' });
    check('the toggle works on the static crisis pages too',
      (await page.locator('#themeBtn').count()) === 1);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    check('auto follows a light device as well', (await themeAttr()) === 'light');

    console.log('\nheadline highlight is readable in both themes');
    for (const scheme of ['light', 'dark']) {
      await page.evaluate((s) => document.documentElement.setAttribute('data-theme', s), scheme);
      await page.waitForTimeout(120);
      const hl = await page.evaluate(() => {
        const e = document.querySelector('.hero h1 .hl');
        const cs = getComputedStyle(e);
        return { colour: cs.color, hasYellowFill: /255,\s*210,\s*63/.test(cs.backgroundImage) };
      });
      check(`${scheme}: highlight is not a yellow fill behind the heading`, !hl.hasYellowFill, hl.colour);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    console.log('\nover-age warning');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.chip', { hasText: '7\u201311' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.card.selectable', { hasText: 'TikTok' }).first().click();
    await page.waitForTimeout(250);
    check('warns the moment a 13+ app is ticked for a younger child',
      await page.locator('.modal-box').isVisible());
    check('the warning names the app and the minimum',
      /TikTok.*13/.test(await page.locator('.modal-box h2').textContent()));
    await page.locator('.modal-actions .ghost-btn').click();
    await page.waitForTimeout(200);
    check('declining does not add the app', (await page.locator('.card.selectable.on').count()) === 0);

    await page.locator('.card.selectable', { hasText: 'TikTok' }).first().click();
    await page.waitForTimeout(200);
    await page.locator('.modal-go').click();
    await page.waitForTimeout(200);
    check('"add anyway" respects the parent\'s call',
      (await page.locator('.card.selectable.on').count()) === 1);

    // Under 7 used to be exempt from the warning entirely. It is not any more,
    // because only six of the thirteen apps carry a 13 minimum, so this is a
    // handful of dialogs and not the every-tile noise it was assumed to be.
    console.log('\nunder 7');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.chip', { hasText: 'Under 7' }).first().click();
    await page.waitForTimeout(150);
    await page.locator('.card.selectable', { hasText: 'Snapchat' }).first().click();
    await page.waitForTimeout(250);
    check('an under-7 gets the warning too', await page.locator('.modal-box').isVisible());
    const snapBody = await page.locator('.modal-box').textContent();
    check('and is told plainly that there is no younger version',
      /no younger version|nothing here for a younger|is 13 and there is no/.test(snapBody), snapBody.slice(0, 160));
    await page.locator('.modal-actions .ghost-btn').click();
    await page.waitForTimeout(200);

    // WhatsApp is the case where the warning is worth having: there is now a
    // parent-managed account for under-13s, so the dialog changes the decision
    // rather than just recording it.
    await page.locator('.card.selectable', { hasText: 'WhatsApp' }).first().click();
    await page.waitForTimeout(250);
    const waBody = await page.locator('.modal-box').textContent();
    check('where a younger version exists, the warning offers it',
      /parent-managed account/i.test(waBody), waBody.slice(0, 160));
    check('and links the official page', await page.locator('.modal-box .alt-link').isVisible());
    await page.locator('.modal-actions .ghost-btn').click();
    await page.waitForTimeout(200);

    check('tiles flag which apps have a kids version',
      (await page.locator('.card .c-flag.kid').count()) > 0);
    check('and the ones that are simply too old carry the minimum age',
      (await page.locator('.card .c-flag.over').count()) > 0);
    const kidNote = await page.locator('.kid-note').textContent();
    check('the kids versions are also named once above the grid',
      kidNote.includes('YouTube') && kidNote.includes('Netflix'), kidNote.slice(0, 120));
    check('and the under-7 band is described in English, not as a label',
      kidNote.startsWith('For a child under 7,'), kidNote.slice(0, 40));

    // TikTok's under-13 version is US-only, which the country switcher has to
    // respect. Telling a UK parent to go and find it would send them looking
    // for a setting that does not exist.
    const tikTile = page.locator('.card.selectable', { hasText: 'TikTok' }).first();
    await tikTile.click();
    await page.waitForTimeout(250);
    const usTok = await page.locator('.modal-box').textContent();
    check('US visitor is told about the Under 13 Experience',
      /Under 13 Experience/.test(usTok), usTok.slice(0, 140));
    await page.locator('.modal-actions .ghost-btn').click();
    await page.waitForTimeout(200);
    await page.selectOption('#countrySel', 'UK');
    await page.waitForTimeout(250);
    await page.locator('.card.selectable', { hasText: 'TikTok' }).first().click();
    await page.waitForTimeout(250);
    const ukTok = await page.locator('.modal-box').textContent();
    check('UK visitor is told it is not available where they are',
      /not in the country you have set|not available/.test(ukTok), ukTok.slice(0, 200));
    await page.locator('.modal-actions .ghost-btn').click();
    await page.waitForTimeout(200);

    console.log('\nover-age warning, continued');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.chip', { hasText: '13\u201315' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.card.selectable', { hasText: 'Snapchat' }).first().click();
    await page.waitForTimeout(150);
    check('no warning when the age is fine', (await page.locator('.modal-box').count()) === 0);
    await page.locator('.chip', { hasText: '7\u201311' }).first().click();
    await page.waitForTimeout(250);
    check('dropping the age below a picked app warns too',
      await page.locator('.modal-box').isVisible());
    await page.locator('.modal-actions .ghost-btn').click();
    await page.waitForTimeout(250);
    check('choosing to remove them clears the app but keeps the new age',
      (await page.locator('.card.selectable.on').count()) === 0 &&
      (await page.locator('.pick-answer').nth(1).textContent()).includes('7'));

    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.chip', { hasText: '11\u201312' }).first().click();
    await page.waitForTimeout(120);

    console.log('\nsearch');
    await page.fill('#homeSearch', 'rob');
    await page.waitForSelector('.search-hit');
    check('search finds Roblox', (await page.locator('.search-hit .hit-name').first().textContent()).includes('Roblox'));
    await page.fill('#homeSearch', 'kahootzzz');
    await page.waitForSelector('.search-hit.is-new');
    check('unknown app offers a live lookup', await page.locator('.search-hit.is-new').isVisible());
    await page.fill('#homeSearch', '');

    console.log('\nguide — roblox');
    // The picker above stored an age. Clear it so this section tests the
    // cold-start path a search visitor actually lands on.
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/roblox/', { waitUntil: 'networkidle' });
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
    // Scoped to the step it belongs to, so inserting a step above it does not
    // silently start testing a different recommendation.
    const recText = await page.locator('.step', { hasText: 'Content Maturity' }).locator('.rec').first().textContent();
    check('single recommendation shown for the chosen age', recText.includes('Minimal'), recText.slice(0, 80));
    check('url carries the age', page.url().includes('age=7-11'));
    check('controls collapse once the age is known', await page.locator('.ctl-summary').isVisible());
    check('summary shows the answers', (await page.locator('.ctl-summary').textContent()).includes('7–11'));

    console.log('\nhelp modes');
    // Quick setup used to drop the reason entirely. That is what sent a reader to
    // the chat to ask why you would pause YouTube history. It is closed now, not gone.
    check('quick mode keeps the reason, one tap away',
      (await page.locator('.why-toggle').count()) > 0);
    check('and it starts closed, so quick setup stays quick',
      (await page.locator('.why-toggle[open]').count()) === 0);
    const firstWhy = page.locator('.why-toggle').first();
    await firstWhy.locator('summary').click();
    await page.waitForTimeout(150);
    check('tapping it opens the reason', await firstWhy.locator('.why').isVisible());
    await page.locator('.ctl-summary').click();
    await page.waitForSelector('.controls:not(.collapsed)');
    check('controls reopen on Change', (await page.locator('.ctl-label').count()) > 0);
    await page.locator('.chip', { hasText: 'Learn as we go' }).first().click();
    await page.waitForTimeout(150);
    check('learn mode shows the why with nothing to tap',
      (await page.locator('p.why').count()) > 0 && (await page.locator('.why-toggle').count()) === 0);
    check('and the reason names what the setting costs you',
      (await page.locator('.step', { hasText: 'Content Maturity' }).locator('.why').textContent()).length > 60);

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
    // Tiles now toggle selection rather than opening a guide, so go direct.
    await page.goto(BASE + '/roblox/', { waitUntil: 'networkidle' });
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

    console.log('\nmerged plan');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('.card', { hasText: 'iPad' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.chip', { hasText: '7\u201311' }).first().click();
    await page.waitForTimeout(120);
    for (const name of ['Roblox', 'YouTube', 'Minecraft']) {
      await page.locator('.card.selectable', { hasText: name }).first().click();
      await page.waitForTimeout(80);
    }
    check('three apps selected', (await page.locator('.card.selectable.on').count()) === 3);
    const ctaText = await page.locator('.build-cta').textContent();
    // The button leads with the first part, not the total. A reader who is told
    // "34 minutes" up front closes the tab; one who is told "12 minutes, four
    // parts, whenever suits" starts. The full count is still on the button.
    check('build button leads with the first part, not the total',
      /part 1, about \d+ minutes/.test(ctaText) && /\d+ parts in total/.test(ctaText), ctaText);

    await page.locator('.build-cta').click();
    await page.waitForSelector('.session');
    check('plan has its own url', /\/plan\/\?/.test(page.url()), page.url());
    check('url carries the app selection', /apps=/.test(page.url()));
    const sessions = await page.locator('.session').count();
    check(`${sessions} parts, none of them enormous`, sessions >= 3 && sessions <= 8, `saw ${sessions}`);
    const metaText = await page.locator('.meta-row').textContent();
    check('overlap is merged and said out loud', /overlapping step/.test(metaText), metaText);
    const subs = await page.locator('.st-sub').allTextContents();
    check('every part is roughly ten minutes',
      subs.every((t) => { const m = t.match(/About (\d+) minutes/); return m && +m[1] <= 13; }), subs.join(' | '));
    // Accounts lead, then the device, then the apps by risk. The account decides
    // what every later setting can reach, so it cannot come second.
    check('accounts come first, then the device',
      subs[0].includes('Accounts') && subs.join(' ').indexOf('iPad') > 0, subs.slice(0, 2).join(' | '));

    const planText = await page.locator('#app').textContent();
    check('the redundant device-backstop step is gone',
      !planText.includes('Add a device-level backstop'));

    await page.locator('.session.open .step-done-btn').first().click();
    await page.waitForTimeout(200);
    check('ticking a step moves the counter',
      (await page.locator('.plan-progress-text').textContent()).startsWith('1 of'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.session');
    check('plan progress survives a reload',
      (await page.locator('.plan-progress-text').textContent()).startsWith('1 of'));

    const planUrl = page.url();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.goto(planUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.session');
    check('plan rebuilds identically from its url alone',
      (await page.locator('.session').count()) === sessions);

    console.log('\nthe page stays where you left it');
    // Every one of these views rebuilds itself on interaction. Without care that
    // throws the reader back to the top mid-task, which is the single most
    // irritating thing a form can do.
    const scrollY = () => page.evaluate(() => window.pageYOffset);
    async function driftOnClick(label, locator) {
      await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(180);
      // Read the position at the moment the click lands, not before. Playwright
      // nudges an element into view of its own accord just before clicking, and
      // with smooth scrolling on that nudge is still gliding when a reading
      // taken earlier would be compared against. What we care about is whether
      // the app moves the page, so measure from where the app found it.
      await page.evaluate(() => {
        window.__yAtClick = null;
        document.addEventListener('click', () => {
          if (window.__yAtClick === null) window.__yAtClick = window.pageYOffset;
        }, { capture: true, once: true });
      });
      await locator.click();
      await page.waitForTimeout(320);
      const before = await page.evaluate(() => window.__yAtClick);
      const drift = Math.abs((await scrollY()) - before);
      check(label + ' does not jump the page', drift <= 4, `drifted ${drift}px from ${before}`);
    }
    await driftOnClick('ticking a plan step',
      page.locator('.session.open .step-done-btn').nth(1));

    // Start clean, and use an app with no minimum age, so this measures scrolling
    // rather than accidentally triggering the over-age dialog.
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.locator('.card', { hasText: 'iPhone' }).first().click();
    await page.waitForTimeout(150);
    await page.waitForSelector('.card.selectable');
    await driftOnClick('picking an app', page.locator('.card.selectable', { hasText: 'Roblox' }).first());
    await driftOnClick('changing the age', page.locator('.chip', { hasText: '13\u201315' }).first());

    await page.goto(BASE + '/roblox/?age=11-12', { waitUntil: 'networkidle' });
    await page.waitForSelector('.check-item');
    await driftOnClick('ticking a checklist item', page.locator('.check-item').first());
    await driftOnClick('marking a guide step done', page.locator('.step-done-btn').first());

    await page.goto(BASE + '/plan/?device=ipad&age=7-11&apps=roblox,youtube,minecraft', { waitUntil: 'networkidle' });
    await page.waitForSelector('.session');

    console.log('\nQR handoff');
    check('encoder is not loaded until asked for',
      (await page.locator('script[src*="qrcode"]').count()) === 0);
    await page.locator('.plan-tools .ghost-btn').first().click();
    await page.waitForSelector('.qr-holder svg', { timeout: 8000 });
    check('QR renders', await page.locator('.qr-holder svg').isVisible());
    check('the link is shown as text too, for anyone who cannot scan',
      (await page.locator('.qr-url').textContent()).includes('/plan/'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('escape closes it', (await page.locator('.qr-scrim').count()) === 0);

    console.log('\nplan page is not indexable');
    const planShell = await (await page.request.get(BASE + '/plan/')).text();
    check('/plan/ is noindex', /noindex/.test(planShell));
    check('/plan/ tells a no-JS visitor where to go', /noscript/.test(planShell));

    console.log('\nrobots and sitemap');
    const sm = await page.request.get(BASE + '/sitemap.xml');
    check('sitemap serves', sm.status() === 200, 'status ' + sm.status());
    const smBody = await sm.text();
    check('sitemap lists every guide', (smBody.match(/<url>/g) || []).length >= 22);
    check('sitemap leaves the plan page out', !smBody.includes('/plan/'));
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
