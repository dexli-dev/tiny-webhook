# TinyWebhook

Temporary webhook inbox. Part of the [dexli.dev](https://dexli.dev) tiny-tools family.

Create a one-off inbox, get a unique URL, send any HTTP request to it, watch the request arrive in real time. Bodies, headers, query strings, and method are captured verbatim for inspection. Inboxes auto-expire after 24 hours; nothing is persisted across restarts.

Built with SvelteKit + adapter-node. No database, no external services — a single Node process with in-memory state.

## Quick start

```bash
git clone https://github.com/dexli-dev/tiny-webhook.git
cd tiny-webhook
npm install
npm run dev          # dev server with HMR → http://localhost:5173
# or, production-style:
npm run build && npm run start   # built server → http://localhost:3000
```

Open the dashboard, click "Create inbox", point any webhook source at the URL it gives you, and watch requests stream in.

## What it does

| Endpoint | Purpose |
| -------- | ------- |
| `POST /api/inboxes` | Create an inbox keyed to a browser-generated secret. Returns the webhook URL + dashboard URL. |
| `/in/{token}` (any method) | The receive endpoint. Captures whatever you throw at it (max body size + per-inbox request cap apply). |
| `GET /api/inboxes/{id}` | Inbox detail. Returns full data with the right Bearer key, a locked shell view otherwise. |
| `GET /api/inboxes/{id}/requests/{rid}` | Full captured request (Bearer-gated). |
| `GET /api/inboxes/{id}/requests/{rid}/raw` | Raw request body as `text/plain` attachment download (Bearer-gated). |
| `GET /api/inboxes/{id}/events` | Server-Sent Events stream of new requests (Bearer-gated). |

The dashboard URL embeds the inbox id; the key lives only in the creator's browser `localStorage`. Lose the key, lose access — only the locked-shell view remains.

## Configuration

All operator-tunable values are environment-driven. Copy `.env.example` to `.env` and edit, or set the vars directly in your runtime. Unset values use the defaults below.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `3000` | Bind port for the Node server. |
| `HOST` | `0.0.0.0` | Bind interface. Use `127.0.0.1` for loopback-only behind a reverse proxy. |
| `PUBLIC_BASE_URL` | _(unset)_ | Origin used when generating webhook & dashboard URLs in `POST /api/inboxes`. When unset, the server derives the origin from the incoming request. When set, this wins. Origin only — no path. **Prod target:** `https://webhook.dexli.dev`. |
| `INBOX_TTL_HOURS` | `24` | Inbox lifetime in hours. |
| `MAX_BODY_BYTES` | `262144` (256 KB) | Max accepted request body size per captured request. Above this → HTTP 413, not recorded. |
| `MAX_REQUESTS_PER_INBOX` | `50` | Max stored requests per inbox; oldest evicted past this. |
| `MAX_INBOXES_PER_IP_PER_HOUR` | `20` | Inbox creation rate limit per source IP. Above this → HTTP 429. |
| `SSE_MAX_PER_INBOX` | `8` | Max concurrent SSE streams per inbox. Past this, new subscribers receive a terminal `event: error` frame and the stream closes. |
| `SSE_MAX_GLOBAL` | `256` | Max concurrent SSE streams across all inboxes. |

Misconfiguration is loud: any env value that's set but unparseable or out of bounds throws at startup. A typo fails fast instead of running with the wrong limit.

### Example: run locally with overrides

```bash
PORT=4000 \
PUBLIC_BASE_URL=https://wh.example.com \
INBOX_TTL_HOURS=1 \
SSE_MAX_PER_INBOX=2 \
npm run start
```

## Deploy

Build a Docker image and run it; pass env vars however your runtime prefers:

```bash
docker build -t tinywebhook .
docker run --rm -p 3000:3000 \
  -e PUBLIC_BASE_URL=https://webhook.example.com \
  tinywebhook
```

The image is a multi-stage build on `node:22-alpine` — runtime stage contains only `build/`, pruned `node_modules/`, and `package.json`. Runs as the unprivileged `node` user. No values are baked into the image beyond fallback defaults; everything operator-tunable comes from the environment at run time.

The provided Dockerfile works as-is with any container runtime that takes environment variables — Docker, Compose, Podman, Kubernetes, Dokploy, Fly, Render, etc. State is in-memory, so a single replica is the simplest model; horizontal scaling would need a real datastore (out of scope for this MVP).

## Security model

- **Inbox keys never leave the browser.** Only their SHA-256 hash is stored server-side; verification is constant-time.
- **Read endpoints are Bearer-gated.** A caller without the right key gets a locked-shell view (URL + expiry + request count) — never the captured content.
- **Bogus-id probes are indistinguishable from real-but-locked inboxes.** Read endpoints synthesize stable per-process shapes for unknown ids; an attacker cannot enumerate live inboxes by shape divergence.
- **Captured content is treated as untrusted.** Raw download forces `text/plain;charset=utf-8` and never reflects the attacker-supplied Content-Type. CSP, X-Frame-Options, no-store, and friends are applied globally via `hooks.server.ts`.
- **Receive endpoint refuses response-only header smuggling.** Inbound `Set-Cookie`, `Server`, `Location`, CSP-family headers, etc. get HTTP 400 and are not recorded.

## Development

```bash
npm run dev        # vite dev server (HMR)
npm run build      # production build via adapter-node
npm run start      # node build/  — runs the production output
npm run check      # svelte-check (types + svelte diagnostics)
npm test           # vitest run (unit + endpoint + adversarial suites)
```

## License

To be added by the project owner before publication.
