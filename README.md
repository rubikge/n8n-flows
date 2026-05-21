# n8n Docker

Self-hosted [n8n](https://n8n.io) instance running in Docker with localtunnel support for public webhook access.

## Requirements

- Docker + Docker Compose
- Node.js (for `npx localtunnel`)

## Quick Start

### 1. Start with public tunnel (recommended)

Starts localtunnel, updates `WEBHOOK_URL`, and restarts n8n in one command:

```bash
./tunnel.sh
```

n8n will be available at `http://localhost:5678`.

### 2. Start without tunnel (local only)

```bash
docker compose up -d
```

## Public Webhooks via localtunnel

`tunnel.sh` automates the full flow:

1. Kills any existing localtunnel process
2. Starts a new tunnel on port `5678`
3. Captures the generated public URL (e.g. `https://xyz.loca.lt`)
4. Updates `WEBHOOK_URL` in `docker-compose.yml`
5. Restarts n8n so it picks up the new URL

After running the script, the Telegram Trigger node (and all other webhook nodes) will show the public URL instead of `localhost`.

> **Note:** The tunnel URL changes on every restart. Run `./tunnel.sh` again after each reboot to get a fresh URL and restart n8n.

## File Layout

```
n8n-docker/
├── docker-compose.yml   # n8n service definition
├── tunnel.sh            # localtunnel + n8n restart helper
└── n8n-files/           # host directory mounted at /files inside container
```

## Setting Up a Telegram Bot Webhook

1. Run `./tunnel.sh` and note the tunnel URL
2. In n8n, add a **Telegram Trigger** node and configure your bot credential
3. Activate the workflow — n8n registers the webhook with Telegram automatically

To verify the webhook is registered:

```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
```

## Stopping

```bash
docker compose down
```

To also stop the background tunnel process, use the PID printed by `tunnel.sh`:

```bash
kill <TUNNEL_PID>
```
