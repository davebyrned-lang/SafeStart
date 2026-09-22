#!/usr/bin/env node
/* The Play Store feature graphic.
 *
 * 1024x500, the banner at the top of the listing. Play wants PNG or JPEG with
 * no alpha channel, so this writes JPEG at high quality: the artwork is flat
 * colour and type, which compresses without visible artefacts, and a JPEG can
 * never accidentally carry transparency.
 *
 *   node scripts/dev-server.js &
 *   node scripts/feature-graphic.js
 *
 * Built from the running site rather than drawn separately, so the shield, the
 * palette and the typeface are the same ones a parent sees after they install.
 * The alternative is a banner that quietly stops matching the app, which is a
 * small lie told at the top of the listing.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'ops', 'store');
const BASE = process.env.BASE || 'http://localhost:3000';

const FOREST = '#2E513C';
const CREAM = '#FBF0E9';
const SPOT = '#D09B6E';

function shieldPath() {
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
  const m = app.match(/\n\s*shield:\s*'([^']+)'/);
  if (!m) throw new Error('feature-graphic: cannot find the shield path in src/app.html');
  return m[1];
}

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: Atkinson;
    src: url("/assets/fonts/atkinson-latin.woff2") format("woff2");
    font-weight: 200 800; font-display: block;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1024px; height: 500px; overflow: hidden; }
  .g {
    width: 1024px; height: 500px; background: ${FOREST};
    position: relative; overflow: hidden;
    font-family: Atkinson, system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 74px;
  }
  /* A very quiet oversized shield bleeding off the right edge. It reads as
     texture at listing size rather than as a second logo competing with the
     one in the lockup. */
  .wash {
    position: absolute; right: -118px; top: -96px;
    width: 700px; height: 700px; opacity: .085;
  }
  .lockup { display: flex; align-items: center; gap: 26px; }
  .mark {
    width: 104px; height: 104px; border-radius: 27px; flex: none;
    background: ${CREAM}; display: grid; place-items: center;
  }
  .mark svg { width: 62px; height: 62px; }
  .name {
    font-size: 88px; font-weight: 800; letter-spacing: -.035em;
    color: ${CREAM}; line-height: 1;
  }
  .tag {
    margin-top: 30px; font-size: 35px; font-weight: 500; line-height: 1.32;
    color: ${CREAM}; opacity: .93; white-space: nowrap;
  }
  .rule {
    margin-top: 26px; width: 132px; height: 7px; border-radius: 4px;
    background: ${SPOT};
  }
</style></head>
<body>
  <div class="g">
    <svg class="wash" viewBox="0 0 24 24" fill="none" stroke="${CREAM}"
         stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      ${shieldPath()}
    </svg>
    <div class="lockup">
      <div class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="${FOREST}" stroke-width="2.15"
             stroke-linecap="round" stroke-linejoin="round">${shieldPath()}</svg>
      </div>
      <div class="name">SafeStart</div>
    </div>
    <div class="tag">Parental controls, made simple.</div>
    <div class="rule"></div>
  </div>
</body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // Served through the dev server rather than set as page content, because the
  // font is fetched over http and a page with no origin cannot have it.
  const tmp = path.join(ROOT, '_feature-graphic.html');
  fs.writeFileSync(tmp, HTML);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 500 },
      deviceScaleFactor: 1,
    });
    await page.goto(BASE + '/_feature-graphic.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT, 'feature-graphic-1024x500.jpg'),
      type: 'jpeg',
      quality: 95,
      clip: { x: 0, y: 0, width: 1024, height: 500 },
    });
    console.log('  wrote ops/store/feature-graphic-1024x500.jpg');
  } finally {
    await browser.close();
    fs.unlinkSync(tmp);
  }
})();
