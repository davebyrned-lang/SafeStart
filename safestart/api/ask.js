// POST /api/ask
//
// Streaming follow-up chat. The curated guide the parent is looking at gets passed in as
// context, so SafeStart builds on it instead of repeating it.
//
// Request body:
//   { messages: [{ role, content }], context: { ageBand, deviceLabel, appLabel,
//     country, helpMode, guideId, guideSummary } }
//
// Response: server-sent events. Each line is `data: {"type":..., ...}`.
//   { type: "searching" }               model started a web search
//   { type: "text", text: "..." }       a chunk of the reply
//   { type: "done" }                    finished
//   { type: "error", message: "..." }   something went wrong

const guidesData = require('../guides.json');
const { callAnthropic, hasApiKey } = require('./_lib/anthropic');
const { chatSystemPrompt } = require('./_lib/prompt');
const { guideToText } = require('./_lib/guidetext');
const rateLimit = require('./_lib/ratelimit');

const MAX_TURNS = 24;
const MAX_CHARS = 4000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  if (!hasApiKey()) {
    return res.status(503).json({
      error: 'not_configured',
      message:
        "Chat isn't switched on for this SafeStart yet. The step-by-step guides all work " +
        'without it.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ error: 'Body was not valid JSON.' });
    }
  }
  body = body || {};

  const ctx = body.context || {};
  const incoming = Array.isArray(body.messages) ? body.messages : [];

  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Send at least one user message.' });
  }

  const limit = rateLimit.check(req, { limit: 25, windowMs: 10 * 60 * 1000, key: 'ask' });
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: 'rate_limited',
      message: "You're going faster than I can keep up with. Give it a couple of minutes.",
    });
  }

  // Build the guide context. Prefer the verified curated guide over anything the client sends.
  let guideText = '';
  let verifiedOn = guidesData.verifiedOn;
  const curated = ctx.guideId && guidesData.guides[ctx.guideId];
  if (curated) {
    guideText = guideToText(curated, ctx.ageBand);
    verifiedOn = curated.lastVerified || verifiedOn;
  } else if (typeof ctx.guideSummary === 'string' && ctx.guideSummary.length) {
    guideText = ctx.guideSummary.slice(0, 8000);
    verifiedOn = null;
  }

  const system = chatSystemPrompt({
    ageBand: ctx.ageBand,
    deviceLabel: ctx.deviceLabel,
    appLabel: ctx.appLabel,
    country: ctx.country,
    helpMode: ctx.helpMode,
    guideText,
    verifiedOn,
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    const upstream = await callAnthropic({
      system,
      messages,
      maxTokens: 1600,
      webSearch: true,
      stream: true,
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch (_) {
          continue;
        }

        if (event.type === 'content_block_start') {
          const blockType = event.content_block?.type;
          if (blockType === 'server_tool_use' || blockType === 'web_search_tool_result') {
            send({ type: 'searching' });
          }
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          send({ type: 'text', text: event.delta.text });
        } else if (event.type === 'error') {
          send({ type: 'error', message: 'The research service returned an error.' });
        }
      }
    }

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('ask failed:', err.message, err.detail || '');
    send({
      type: 'error',
      message:
        "I couldn't reach the research service just then. Try asking again in a moment — " +
        'the guide on screen is still good.',
    });
    res.end();
  }
};
