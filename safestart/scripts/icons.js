#!/usr/bin/env node
/* Icon generator.
 *
 * The icons in assets/ were the TrustRaise navy shield, which stopped matching
 * the site when SafeStart got its own palette. An app icon that does not look
 * like the thing it opens is a small lie, and on Android it sits on a home
 * screen next to the real one, so it matters more than it did as a favicon.
 *
 * Everything here is drawn from the same shield path the site uses in its
 * header, so there is one shield and it lives in src/app.html. Change it there
 * and rerun this.
 *
 *   node scripts/icons.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets');

const FOREST = '#2E513C';

// Lifted from ICONS.shield in src/app.html rather than redrawn, so the app icon
// and the mark in the header cannot drift apart.
function shieldPath() {
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
  const m = app.match(/\n\s*shield:\s*'([^']+)'/);
  if (!m) throw new Error('icons: cannot find the shield path in src/app.html');
  return m[1];
}

/* `scale` is the shield's width as a fraction of the square.
 *
 * Android maskable icons get cropped to whatever shape the launcher wants, and
 * only the middle 80% is guaranteed to survive. So the maskable variant draws
 * the shield much smaller. Get this wrong and the shield loses its edges on a
 * circular launcher, which is most of them. */
function svg(size, scale, rounded) {
  const inner = size * scale;
  const off = (size - inner) / 2;
  const r = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${FOREST}"/>
  <g transform="translate(${off} ${off}) scale(${inner / 24})">
    <g fill="none" stroke="#FFFFFF" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round">
      ${shieldPath()}
    </g>
  </g>
</svg>`;
}

/* The -v2 suffix is not decoration. /assets/ is served with a one-year
   immutable Cache-Control, so overwriting a filename leaves every browser that
   has ever loaded the site showing the old navy TrustRaise shield until 2027.
   New content gets a new name. If these are ever redrawn, bump to v3. */
const JOBS = [
  // name,                    size, shield scale, rounded corners
  ['icon-192-v2.png',          192, 0.56, false],
  ['icon-512-v2.png',          512, 0.56, false],
  ['icon-maskable-512-v2.png', 512, 0.40, false],
  ['apple-touch-icon-v2.png',  180, 0.56, true],
  ['favicon-64-v2.png',         64, 0.60, true],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, scale, rounded] of JOBS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg(size, scale, rounded)}</body>`,
      { waitUntil: 'load' }
    );
    await page.screenshot({
      path: path.join(OUT, name),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log('  wrote assets/' + name + '  ' + size + 'px');
  }
  await browser.close();
})();
