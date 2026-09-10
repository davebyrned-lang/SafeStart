// POST /api/feedback
//
// The feedback form. A reader spotting something wrong is the most valuable thing
// this site receives, so the route to say so has to be one tap from the page they
// are looking at, not an email address they have to go and find.
//
// Request body:
//   { message, email?, page?, website? }
//
// `website` is a honeypot. It is hidden from people and left empty by them; bots
// fill every field they find, so anything arriving with it set is dropped and
// answered with a cheerful 200 so the sender learns nothing.
//
// Delivery is Resend, called over plain fetch so there is no dependency to install
// and nothing to build. If RESEND_API_KEY is unset the endpoint says so plainly and
// the form falls back to opening the reader's own mail app, which means the page is
// never broken, only less convenient.

const rateLimit = require('./_lib/ratelimit');

const TO = process.env.FEEDBACK_TO || 'dave@trust-raise.com';
// Resend needs a verified domain to send as. Until trust-raise.com is verified,
// their onboarding sender works and mail still arrives.
const FROM = process.env.FEEDBACK_FROM || 'SafeStart <onboarding@resend.dev>';

const MAX_MESSAGE = 4000;
const MAX_EMAIL = 200;
const MAX_PAGE = 300;

// Deliberately loose. The point is to catch a typo before someone waits for a reply
// that can never arrive, not to litigate RFC 5322.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasKey() {
  return Boolean(process.env.RESEND_API_KEY);
}

// Anything that reaches a mail header gets its newlines removed first. Without this
// a message body could inject extra headers, which is how open relays happen.
function oneLine(s, max) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {
      return res.status(400).json({ error: 'bad_json', message: 'Body was not valid JSON.' });
    }
  }
  body = body || {};

  // Honeypot. Answer as though it worked.
  if (oneLine(body.website, 100)) return res.status(200).json({ ok: true });

  const message = String(body.message == null ? '' : body.message).trim().slice(0, MAX_MESSAGE);
  const email = oneLine(body.email, MAX_EMAIL);
  const page = oneLine(body.page, MAX_PAGE);

  if (message.length < 2) {
    return res.status(400).json({
      error: 'empty',
      message: 'Tell us what you saw and we will look at it.',
    });
  }
  if (email && !LOOKS_LIKE_EMAIL.test(email)) {
    return res.status(400).json({
      error: 'bad_email',
      message: 'That email address does not look right. Leave it blank if you would rather not.',
    });
  }

  // Six in ten minutes is generous for a person and tedious for a script.
  const limit = rateLimit.check(req, { limit: 6, windowMs: 10 * 60 * 1000, key: 'feedback' });
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter || 60));
    return res.status(429).json({
      error: 'rate_limited',
      message: 'That is a few messages in a short time. Try again in a little while.',
    });
  }

  if (!hasKey()) {
    // Not an error the reader caused, and not one they should have to decode.
    return res.status(503).json({
      error: 'not_configured',
      message: 'Sending is not switched on yet. You can email it instead.',
      mailto: TO,
    });
  }

  const lines = [
    message,
    '',
    '---',
    page ? 'Page: ' + page : 'Page: not given',
    email ? 'Reply to: ' + email : 'Reply to: not given',
    'Received: ' + new Date().toISOString(),
  ];

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: 'SafeStart feedback' + (page ? ': ' + page : ''),
        text: lines.join('\n'),
        // So hitting reply in the mail client goes to the reader, when they gave one.
        ...(email ? { reply_to: email } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('feedback: resend returned ' + r.status + ' ' + detail.slice(0, 500));
      return res.status(502).json({
        error: 'send_failed',
        message: 'That did not send. You can email it instead.',
        mailto: TO,
      });
    }
  } catch (err) {
    console.error('feedback: ' + (err && err.message));
    return res.status(502).json({
      error: 'send_failed',
      message: 'That did not send. You can email it instead.',
      mailto: TO,
    });
  }

  return res.status(200).json({ ok: true });
};

module.exports.hasKey = hasKey;
