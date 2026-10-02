# mochie-tg-relay

A tiny, dependency-free reverse proxy for the Telegram Bot API.

It exists so a client that cannot reach `api.telegram.org` directly (for example
a host behind the Great Firewall) can still use the Bot API through this relay.

```
Telegram  <->  api.telegram.org  <->  mochie-tg-relay (Render)  <->  client
```

## Endpoints

- `/_health` returns `200 ok` (used as the Render health check).
- Everything else is proxied verbatim to `https://api.telegram.org` (method,
  path, query, headers and body are preserved; responses are streamed back).

## Environment

- `TELEGRAM_BOT_TOKEN` (recommended): when set, only requests for this bot
  (`/bot<TOKEN>/...`) are proxied, anything else returns 404. Without it the
  relay is an open Telegram API proxy, which you do not want on a public URL.

## Using it

Point the client's API root at the relay instead of `api.telegram.org`, and let
the client append `/bot<TOKEN>/<method>` as usual.

## Deploy

See the settings in `render.yaml`, or create a Render Web Service from this
public repo with:

- Runtime: Node
- Build Command: (default, no dependencies)
- Start Command: `node server.js`
- Instance Type: Free
- Region: Singapore
- Health Check Path: `/_health`
- Env: `TELEGRAM_BOT_TOKEN`
