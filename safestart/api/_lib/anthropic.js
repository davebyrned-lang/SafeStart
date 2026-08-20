// Thin wrapper around the Anthropic Messages API.
// No SDK dependency — Node 18+ has global fetch, which keeps the deploy tiny.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: Number(process.env.MAX_WEB_SEARCHES || 5),
};

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error(
      'ANTHROPIC_API_KEY is not set. Add it in Vercel under Settings → Environment Variables.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }
  return key;
}

function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function callAnthropic({ system, messages, maxTokens = 2000, webSearch = true, stream = false }) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (webSearch) body.tools = [WEB_SEARCH_TOOL];
  if (stream) body.stream = true;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Anthropic API returned ${res.status}`);
    err.status = res.status;
    err.detail = detail.slice(0, 500);
    throw err;
  }

  return res;
}

/** Non-streaming call. Returns the concatenated text of the final assistant turn. */
async function complete(opts) {
  const res = await callAnthropic({ ...opts, stream: false });
  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return { text, usage: data.usage, raw: data };
}

module.exports = { callAnthropic, complete, hasApiKey, MODEL, API_VERSION };
