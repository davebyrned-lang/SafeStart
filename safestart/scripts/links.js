#!/usr/bin/env node
/* Are the official sources still where we said they were?
 *
 *   node scripts/links.js
 *
 * This is a different question from the freshness check, and a more basic one.
 * Freshness asks "did the instructions change". This asks "does the page still
 * exist at all". Link rot is more common than content drift and much cheaper to
 * spot, and unlike freshness it works on every guide, including the ones whose
 * content no automated reader can get at. A 404 is a 404 whether or not the page
 * is rendered by JavaScript.
 *
 * It found three dead links the first time it ran: PlayStation's PS5 parental
 * controls page, the Xbox Family Settings app page and a Microsoft Family Safety
 * article, all still cited on a site whose whole promise is that it links you to
 * the official source.
 *
 * Not run by `npm test`, because that has to work offline and finish quickly.
 * The weekly job runs it.
 *
 * A 403 or a 400 is not a broken link. Several of these platforms reject anything
 * that looks automated while serving the same page perfectly to a person, so those
 * are reported and not failed on. Only a definite 404 or 410 fails.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'guides.json'), 'utf8'));
const SG = JSON.parse(fs.readFileSync(path.join(ROOT, 'safeguarding.json'), 'utf8'));

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Definitely gone. Anything else is a maybe, and a maybe should not fail a build.
const DEAD = [404, 410];
// Served to people, refused to robots. Worth listing, not worth failing.
const BLOCKED = [400, 401, 403, 405, 429, 999];

let broken = 0;
let blocked = 0;
let unreachable = 0;
let fine = 0;

function collect() {
  const out = [];
  const add = (where, url, label) => {
    if (url && /^https?:\/\//.test(url)) out.push({ where, url, label: label || '' });
  };

  Object.keys(DATA.guides).forEach((id) => {
    const g = DATA.guides[id];
    (g.links || []).forEach((l) => add(id, l.url, l.label));
    if (g.kidsAlt) add(id + ' (kids version)', g.kidsAlt.link, g.kidsAlt.name);
  });

  // The crisis pages matter more than any of the guides. A parent following a
  // dead reporting link is the worst failure this site could have.
  Object.keys(SG.byCountry || {}).forEach((c) => {
    (SG.byCountry[c].bodies || []).forEach((b) => add('help/' + c, b.url, b.name));
  });
  (SG.platforms || []).forEach((p) => add('help/platforms', p.url, p.name));

  // Same URL cited by several guides only needs fetching once.
  const seen = new Map();
  out.forEach((e) => {
    if (!seen.has(e.url)) seen.set(e.url, { ...e, where: [e.where] });
    else seen.get(e.url).where.push(e.where);
  });
  return [...seen.values()];
}

async function head(url) {
  /* HEAD first, because it is the lightest thing that answers the question.
     But HEAD is only an optimisation, and plenty of servers handle it badly.
     Google's support pages answer HEAD with 404 and GET with 200, which had this
     script confidently reporting twelve dead links on its first run, five of them
     on the crisis pages. So any non-success on HEAD is treated as inconclusive
     and confirmed with a real GET before anything is called dead. */
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (method === 'HEAD' && res.status >= 400) continue;
      return { status: res.status, final: res.url };
    } catch (err) {
      if (method === 'GET') return { status: 0, error: err.name || String(err) };
    }
  }
  return { status: 0, error: 'no response' };
}

(async () => {
  const links = collect();
  console.log(`\nchecking ${links.length} official source links\n`);

  // Gently. These are other people's servers and this runs unattended.
  const size = 6;
  for (let i = 0; i < links.length; i += size) {
    const batch = links.slice(i, i + size);
    const results = await Promise.all(batch.map((l) => head(l.url)));
    batch.forEach((l, n) => {
      const r = results[n];
      const who = l.where.join(', ');
      if (DEAD.includes(r.status)) {
        broken++;
        console.error(`  DEAD  ${r.status}  ${who}\n        ${l.url}`);
      } else if (BLOCKED.includes(r.status)) {
        blocked++;
        console.log(`  bot?  ${r.status}  ${who}  ${l.url}`);
      } else if (!r.status) {
        unreachable++;
        console.log(`  ????  ${r.error}  ${who}  ${l.url}`);
      } else {
        fine++;
      }
    });
  }

  console.log(`\n  ${fine} fine, ${blocked} refuse automated clients, ${unreachable} no answer, ${broken} dead`);
  if (blocked || unreachable) {
    console.log('  Refused and no-answer are not failures. Those hosts serve people fine.');
  }
  if (broken) {
    console.error(`\nFAILED — ${broken} dead link(s). A source link that 404s is worse than no source link.\n`);
    process.exit(1);
  }
  console.log('\nPASSED — every official source still resolves.\n');
})();
