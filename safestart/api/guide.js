// GET /api/guide?app=Kahoot&device=ipad&age=11-12&country=US
//
// Builds a SafeStart guide for a platform that isn't in the curated database yet.
// This is a GET on purpose: Vercel's CDN caches the response, so the second parent asking
// about the same app gets an instant answer and costs nothing.

const guidesData = require('../guides.json');
const { complete, hasApiKey } = require('./_lib/anthropic');
const { guideSystemPrompt } = require('./_lib/prompt');
const rateLimit = require('./_lib/ratelimit');

// Cache generated guides at the edge. 7 days fresh, 30 days stale-while-revalidate.
const CACHE = 'public, s-maxage=604800, stale-while-revalidate=2592000';

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function extractJson(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fenced.length ? fenced.map((m) => m[1]) : [];

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates.reverse()) {
    try {
      return JSON.parse(c.trim());
    } catch (_) {
      /* try the next candidate */
    }
  }
  return null;
}

function validate(guide) {
  if (!guide || typeof guide !== 'object') return 'Response was not an object.';
  if (!guide.name) return 'Guide is missing a name.';
  if (!Array.isArray(guide.steps) || guide.steps.length === 0) return 'Guide has no steps.';
  for (const step of guide.steps) {
    if (!step.title) return 'A step is missing a title.';
    if (!Array.isArray(step.do) || step.do.length === 0) {
      return `Step "${step.title}" has no instructions.`;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }

  const app = (req.query.app || '').toString().trim();
  const device = (req.query.device || '').toString().trim();
  const age = (req.query.age || '').toString().trim();
  const country = (req.query.country || '').toString().trim();

  if (!app) return res.status(400).json({ error: 'Tell me which app or platform.' });
  if (app.length > 60) return res.status(400).json({ error: 'That name is too long.' });

  // Already curated? Hand back the verified version, free and instant.
  const id = slugify(app);
  if (guidesData.guides[id]) {
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).json({ guide: guidesData.guides[id], source: 'curated' });
  }

  if (!hasApiKey()) {
    return res.status(503).json({
      error: 'not_configured',
      message:
        "SafeStart doesn't have a guide for that one yet, and live lookups aren't switched on. " +
        'Try one of the guides on the home screen, or check the platform\'s own support site.',
    });
  }

  const limit = rateLimit.check(req, { limit: 8, windowMs: 10 * 60 * 1000, key: 'guide' });
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: 'rate_limited',
      message: "That's a lot of new guides at once. Give it a few minutes and try again.",
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const askFor = [
    `Platform: ${app}`,
    device ? `Device: ${device}` : null,
    age ? `Child's age band: ${age}` : null,
    country ? `Country: ${country}` : null,
    `Today's date: ${today}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const { text } = await complete({
      system: guideSystemPrompt(),
      messages: [
        {
          role: 'user',
          content:
            `Build a SafeStart parental control guide for the following.\n\n${askFor}\n\n` +
            'Search for the current official documentation first, then output the JSON block.',
        },
      ],
      maxTokens: 4000,
      webSearch: true,
    });

    const guide = extractJson(text);
    const problem = validate(guide);

    if (problem) {
      return res.status(502).json({
        error: 'bad_guide',
        message:
          "I found information on that one but couldn't lay it out cleanly. Try again, or " +
          'ask me about it in the chat instead.',
        detail: problem,
      });
    }

    guide.id = guide.id || id;
    guide.type = guide.type || 'app';
    guide.generated = true;
    guide.lastVerified = guide.lastVerified || today;
    guide.sourceConfidence = guide.sourceConfidence || 'medium';

    res.setHeader('Cache-Control', CACHE);
    return res.status(200).json({ guide, source: 'generated' });
  } catch (err) {
    const status = err.code === 'NO_API_KEY' ? 503 : 502;
    console.error('guide generation failed:', err.message, err.detail || '');
    return res.status(status).json({
      error: 'upstream',
      message:
        "I couldn't reach the research service just now. Give it a moment and try again, " +
        'or pick one of the ready-made guides.',
    });
  }
};
