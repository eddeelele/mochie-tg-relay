'use strict';

// Transparent reverse proxy for the Telegram Bot API.
// Purpose: let a client that cannot reach api.telegram.org (for example a host
// behind the Great Firewall) talk to the Bot API through this relay.
//
// Env:
//   PORT                listen port (Render injects this; default 10000)
//   TELEGRAM_BOT_TOKEN  optional. When set, only requests for this bot are
//                       proxied; everything else gets 404. Strongly recommended
//                       so the relay cannot be used as an open Telegram proxy.
//   UPSTREAM            optional upstream host (default api.telegram.org)

const http = require('http');
const https = require('https');

const UPSTREAM = (process.env.UPSTREAM || 'api.telegram.org').trim();
const PORT = Number(process.env.PORT || 10000);
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

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

function handle(req, res) {
  if (req.url === '/_health' || req.url === '/_health/') {
    return send(res, 200, 'ok');
  }

  if (BOT_TOKEN) {
    const allowed = '/bot' + BOT_TOKEN + '/';
    if (!req.url.startsWith(allowed)) {
      return send(res, 404, 'not found');
    }
  }

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers.host = UPSTREAM;

  const proxied = https.request(
    { hostname: UPSTREAM, port: 443, method: req.method, path: req.url, headers },
    (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    }
  );

  proxied.on('error', (err) => {
    if (!res.headersSent) send(res, 502, 'relay upstream error: ' + err.message);
    else res.end();
  });

  req.on('aborted', () => proxied.destroy());
  req.pipe(proxied);
}

const server = http.createServer(handle);
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0; // allow long-polling getUpdates to stay open

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    'tg-relay listening on :' + PORT + ' -> ' + UPSTREAM +
    (BOT_TOKEN ? ' (restricted to one bot)' : ' (OPEN: set TELEGRAM_BOT_TOKEN)')
  );
});
