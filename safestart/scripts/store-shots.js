#!/usr/bin/env node
/* Play Store screenshots.
 *
 * Play wants 2 to 8 phone screenshots. These are rendered from the real running
 * site rather than mocked up in a design tool, so a parent who installs the app
 * gets the thing they were shown. If a guide changes, rerun this.
 *
 *   node scripts/dev-server.js &
 *   node scripts/store-shots.js
 *
 * 360x800 at 3x gives 1080x2400, which is a common modern phone ratio and well
 * inside Play's limits (min 320px, max 3840px on any side).
 *
 * The plan shot uses a made-up child: age band 11-12, an Android phone, three
 * apps. Nothing here is real, and nothing should ever be, because a plan URL
 * describes one specific child and this one is going on a public store page.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'ops', 'store');

const W = 360, H = 800, SCALE = 3;

const SHOTS = [
  ['01-picker.png', '/', null],
  ['02-plan.png', '/plan/?age=11-12&device=android&apps=roblox,youtube,whatsapp&country=UK&setup=1', null],
  ['03-guide.png', '/roblox/', null],
  ['04-device.png', '/android/', null],
  ['05-help.png', '/help/uk/', null],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();

  for (const [name, url, prep] of SHOTS) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    // The plan is assembled in the browser from the query string, so give it a
    // beat to finish rather than photographing a spinner.
    await page.waitForTimeout(900);
    if (prep) await prep(page);
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('  wrote ops/store/' + name);
  }

  await browser.close();
})();
