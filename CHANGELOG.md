# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Ideas / Next Steps
- Extract sensitive config (`WEBHOOK_URL`, timezone) into a `.env` file so `docker-compose.yml` stays clean in git
- Add n8n workflow export/backup script to version-control workflow definitions
- Add a `Makefile` with shortcuts: `make up`, `make tunnel`, `make down`, `make logs`
- Set up cloudflared with a named tunnel + custom domain for a permanent URL

---

## [0.2.0] — 2026-05-21

### Changed
- Replaced localtunnel with **cloudflared** in `tunnel.sh` — more reliable, no traffic limits
- Added `local` mode: `./tunnel.sh local` starts n8n without a tunnel (sets `WEBHOOK_URL=http://localhost:5678`)
- Health-check interval increased from 15 s to 30 s (cloudflared is self-healing, less polling needed)
- Tunnel log path changed from `/tmp/localtunnel.log` to `/tmp/cloudflared.log`

---

## [0.1.0] — 2026-05-21

### Added
- `docker-compose.yml` — n8n service on port 5678 with persistent Docker volume and host-mounted `/files` directory
- `tunnel.sh` — automated localtunnel lifecycle manager:
  - starts localtunnel on port 5678
  - captures the generated `*.loca.lt` URL
  - patches `WEBHOOK_URL` in `docker-compose.yml`
  - restarts n8n via `docker compose`
  - health-checks the tunnel every 15 s and auto-restarts on failure
- `README.md` — setup and usage documentation

### Changed
- Switched from fixed localtunnel subdomain to dynamic subdomain (avoids subdomain conflicts on restart)
- Updated `WEBHOOK_URL` in `docker-compose.yml` to track the active tunnel URL

### Known Limitations
- Tunnel URL changes on every `tunnel.sh` run — Telegram webhook (and any other external service) must be re-registered after each restart
- localtunnel is unreliable under heavy load; cloudflared is the recommended long-term replacement
