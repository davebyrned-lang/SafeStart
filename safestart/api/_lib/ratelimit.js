// Lightweight in-memory rate limiting.
//
// Serverless instances are ephemeral and there can be several running at once, so this is
// a speed bump rather than a wall. It is enough to stop a single bored visitor burning
// through your API credit. If SafeStart gets real traffic, swap this for Vercel KV or
// Upstash Redis — see README.

const BUCKETS = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * @returns {{ ok: boolean, retryAfter?: number }}
 */
function check(req, { limit = 12, windowMs = 10 * 60 * 1000, key = 'default' } = {}) {
  const id = `${key}:${clientIp(req)}`;
  const now = Date.now();

  let hits = BUCKETS.get(id) || [];
  hits = hits.filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    BUCKETS.set(id, hits);
    return { ok: false, retryAfter };
  }

  hits.push(now);
  BUCKETS.set(id, hits);

  // Opportunistic cleanup so the map can't grow forever on a warm instance.
  if (BUCKETS.size > 5000) {
    for (const [k, v] of BUCKETS) {
      if (!v.length || now - v[v.length - 1] > windowMs) BUCKETS.delete(k);
    }
  }

  return { ok: true };
}

module.exports = { check, clientIp };
