# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Ideas / Next Steps
- Replace localtunnel with [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for stable, persistent URLs (no restart needed)
- Extract sensitive config (`WEBHOOK_URL`, timezone) into a `.env` file so `docker-compose.yml` stays clean in git
- Add n8n workflow export/backup script to version-control workflow definitions
- Add a `Makefile` with shortcuts: `make up`, `make tunnel`, `make down`, `make logs`

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
