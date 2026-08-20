#!/usr/bin/env node
// Local dev server. Serves the static site and routes /api/* to the same handler files
// Vercel runs in production.
//
//   node scripts/dev-server.js        → http://localhost:3000
//
// `vercel dev` does the same thing and is closer to production, but this needs no login
// and no install.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

// Load .env.local if present, so the API key works locally.
try {
  const envFile = path.join(ROOT, '.env.local');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  }
} catch (_) { /* optional */ }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsed.pathname);

  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No such endpoint.' }));
    }

    // Shim the bits of the Vercel request/response helpers the handlers use.
    req.query = parsed.query;
    if (req.method === 'POST') {
      const raw = await readBody(req);
      try { req.body = JSON.parse(raw || '{}'); } catch (_) { req.body = raw; }
    }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
      return res;
    };

    try {
      delete require.cache[require.resolve(file)];
      const handler = require(file);
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'handler_threw', message: err.message }));
    }
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }

  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`SafeStart dev server → http://localhost:${PORT}`);
  console.log(
    process.env.ANTHROPIC_API_KEY
      ? 'API key found: live guides and chat are on.'
      : 'No ANTHROPIC_API_KEY: curated guides work, chat and live lookups will return 503.'
  );
});
