# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Ideas / Next Steps
- Set `--min-instances=1` on Cloud Run if Telegram cold-start latency becomes annoying
- Lock down Postgres access (currently public IP + password-only) — possibly via Serverless VPC Connector
- Automate the Angie workflow re-deploy / config-as-code from `angie-workflow.json`
- Add a gate before "Send to Telegram" in the Zoom workflow so duplicate Zoom redeliveries (same `zoom_meeting_uuid`) don't re-send the message

---

## [0.5.0] — 2026-05-24

### Added
- New workflow **Zoom recording → summary → Telegram** (id `8v101lnwYq4QCjgY`, created inactive) — when a Zoom cloud recording finishes, downloads the M4A, transcribes it with Gemini 2.5 Flash, summarizes it, inserts a row into the new `meeting_summaries` Postgres table, and sends the summary to Telegram chat `63277017` via the existing Yarik Bot
- New table `meeting_summaries` on `n8n-pg-vm` (Postgres on the existing VM) with a `UNIQUE` constraint on `zoom_meeting_uuid` so Zoom redeliveries don't duplicate rows
- New n8n Postgres credential `n8n-pg-vm` (id `ieqLZNc7deNhXoPR`) pointing at `35.254.188.80:5432`, db `n8n`, user `n8n-user`
- `zoom-summary-workflow.json` — checked-in export (no embedded secrets), mirrors the `angie-workflow.json` pattern

### Required follow-up (manual, before activation)
- Create a Zoom Marketplace **Server-to-Server OAuth** app subscribed to `recording.completed`; copy its Secret Token
- Set `ZOOM_WEBHOOK_SECRET=<token>` env var on the Cloud Run service (`gcloud run services update n8n --update-env-vars=ZOOM_WEBHOOK_SECRET=...`)
- Activate the workflow in the n8n UI to register the production webhook URL, then paste it into the Zoom app event subscription so the `endpoint.url_validation` handshake can complete

---

## [0.4.0] — 2026-05-24

### Removed
- Local Docker stack: `docker-compose.yml`, `tunnel.sh`, `.env`, `n8n-files/` — the repo is now cloud-only

### Changed
- README.md and CLAUDE.md rewritten to describe only the Cloud Run instance and its `gcloud` ops surface
- `n8n-mcp` MCP server reconfigured to point at the Cloud Run URL with a cloud-instance API key (was: `http://localhost:5678`)
- `.claude/settings.local.json` permission list pruned to drop `docker compose` / `./tunnel.sh` and add `gcloud secrets`, `gcloud iam`, `gcloud services list`, n8n MCP health check

---

## [0.3.0] — 2026-05-24

### Added
- GCP Cloud Run deployment of n8n at https://n8n-344511854894.us-central1.run.app, backed by Postgres on a free-tier `e2-micro` VM (`n8n-pg-vm`, `us-central1-a`, static IP `35.254.188.80`)
- Secret Manager secrets for the DB password and the n8n encryption key
- `n8n-service-account` with `secretmanager.secretAccessor` + `run.invoker (allUsers)` bindings
- `angie-workflow.json` — canonical export of the Angie workflow (no credentials embedded)
- CLAUDE.md section documenting the GCP deployment, ops commands, and project-level org policy overrides (`compute.vmExternalIpAccess` and `iam.allowedPolicyMemberDomains`)

### Changed
- Angie workflow now lives on Cloud Run; local docker-compose setup is dormant (only one n8n can hold the Telegram webhook at a time)

### Fixed (Angie hardening before migration)
- Inserted "Ack: processing" Telegram node so the user gets immediate feedback while the agent works
- Added "Truncate output" Set node that strips Markdown special chars (`*`, `_`, `` ` ``, `[`, `]`) and caps reply length at 4000 chars — fixes Telegram `can't parse entities` and `message too long` errors
- Wired the Gmail credential to the Gmail tool node
- Removed Google Tasks node + corresponding line in the agent's system prompt

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
