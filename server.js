'use strict';

// Transparent reverse proxy.
// Purpose: let a client that cannot reach a blocked upstream (for example a
// host behind the Great Firewall) talk to that upstream through this relay.
//
// Routes:
//   /_health                      -> 'ok'
//   /bot<TELEGRAM_BOT_TOKEN>/...  -> api.telegram.org (Telegram Bot API)
//   /anthropic/v1/...             -> api.anthropic.com (Anthropic Messages API)
//
// Env:
//   PORT                    listen port (Render injects this; default 10000)
//   TELEGRAM_BOT_TOKEN      optional. When set, only requests for this bot are
//                           proxied; everything else gets 404. Strongly
//                           recommended so the relay cannot be used as an open
//                           Telegram proxy.
//   ANTHROPIC_RELAY_SECRET  optional. When set, /anthropic/* requires this value
//                           in the x-relay-secret header; every other caller
//                           gets 404. When unset, /anthropic/* stays disabled.
//   UPSTREAM                optional Telegram upstream host (default api.telegram.org)

const http = require('http');
const https = require('https');

const UPSTREAM = (process.env.UPSTREAM || 'api.telegram.org').trim();
const PORT = Number(process.env.PORT || 10000);
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

const ANTHROPIC_UPSTREAM = 'api.anthropic.com';
const ANTHROPIC_PREFIX = '/anthropic';
const ANTHROPIC_SECRET = (process.env.ANTHROPIC_RELAY_SECRET || '').trim();

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function send(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function forward(req, res, upstream, path) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers.host = upstream;

  const proxied = https.request(
    { hostname: upstream, port: 443, method: req.method, path, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  proxied.on('error', (err) => {
    if (!res.headersSent) send(res, 502, 'relay upstream error: ' + err.message);
    else res.end();
  });

  req.on('aborted', () => proxied.destroy());
  req.pipe(proxied);
}

function handle(req, res) {
  if (req.url === '/_health' || req.url === '/_health/') {
    return send(res, 200, 'ok');
  }

  if (req.url === ANTHROPIC_PREFIX || req.url.startsWith(ANTHROPIC_PREFIX + '/')) {
    if (!ANTHROPIC_SECRET) return send(res, 404, 'not found');
    if (req.headers['x-relay-secret'] !== ANTHROPIC_SECRET) {
      return send(res, 404, 'not found');
    }
    let rest = req.url.slice(ANTHROPIC_PREFIX.length);
    if (!rest.startsWith('/')) rest = '/' + rest;
    return forward(req, res, ANTHROPIC_UPSTREAM, rest);
  }

  if (BOT_TOKEN) {
    const allowed = '/bot' + BOT_TOKEN + '/';
    if (!req.url.startsWith(allowed)) {
      return send(res, 404, 'not found');
    }
  }

  forward(req, res, UPSTREAM, req.url);
}

const server = http.createServer(handle);
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0; // allow long-polling getUpdates to stay open

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    'tg-relay listening on :' + PORT +
    ' -> telegram=' + UPSTREAM + ', anthropic=' + ANTHROPIC_UPSTREAM +
    (BOT_TOKEN ? ' (telegram restricted to one bot)' : ' (TELEGRAM OPEN: set TELEGRAM_BOT_TOKEN)') +
    (ANTHROPIC_SECRET ? ' (anthropic gated)' : ' (anthropic disabled: set ANTHROPIC_RELAY_SECRET)')
  );
});
