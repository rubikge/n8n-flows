# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo manages a single n8n instance running on **Google Cloud Run**. Two workflows live there: the Angie Telegram-AI assistant and the Zoom recording → summary → Telegram pipeline. The `n8n-mcp` MCP server is configured to talk to this instance, so MCP tools (`mcp__n8n-mcp__n8n_*`) operate directly on the cloud workflows.

There are no tests, linters, or build steps — this is a configuration / ops repo.

## Cloud n8n

| Resource | Value |
|---|---|
| GCP project | `n8n-test-496616` (project number `344511854894`) |
| Region / zone | `us-central1` / `us-central1-a` |
| Cloud Run service | `n8n` → https://n8n-344511854894.us-central1.run.app |
| VM (Postgres) | `n8n-pg-vm` (`e2-micro`, Debian 12, 30GB disk), static IP `35.254.188.80`, Postgres 15 in Docker, port 5432 |
| Service account | `n8n-service-account@n8n-test-496616.iam.gserviceaccount.com` |
| Secrets (Secret Manager) | `n8n-db-password`, `n8n-encryption-key` |
| Firewall | `n8n-pg-fw`: tcp:5432 from `0.0.0.0/0` on VMs tagged `n8n-pg` |

`angie-workflow.json` and `zoom-summary-workflow.json` are checked-in exports (no credentials embedded). The live workflows on Cloud Run are the source of truth; the JSON files are backups / references for diffs and restores.

## Workflows

| Workflow | Live ID | Purpose |
|---|---|---|
| Angie, personal AI assistant with Telegram voice and text | `GL1AZv0gEcz66PDQ` | Telegram chat-trigger AI assistant with Gmail tool access |
| Zoom recording → summary → Telegram | `8v101lnwYq4QCjgY` | Webhook trigger on Zoom `recording.completed`: downloads M4A audio, transcribes & summarizes with Gemini 2.5 Flash, writes a row to the `meeting_summaries` Postgres table, sends summary to Telegram chat `63277017` via Yarik Bot |

### Zoom workflow specifics

- Trigger is a generic `n8n-nodes-base.webhook` (n8n has no native Zoom trigger node). The path is `/webhook/zoom-recording-completed`.
- Branches on the `endpoint.url_validation` event so Zoom's webhook handshake (HMAC-SHA256 of `plainToken` with the app's Secret Token) is answered in-workflow.
- Requires three Cloud Run env vars (already set on the service):
  - `ZOOM_WEBHOOK_SECRET` — the Zoom Marketplace app's Secret Token, read by the "Hash plainToken" Code node as `$env.ZOOM_WEBHOOK_SECRET`
  - `NODE_FUNCTION_ALLOW_BUILTIN=crypto` — whitelists Node's built-in `crypto` module in the Code-node sandbox so `require('crypto')` works
  - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` — lets Code nodes read env vars via `$env.X` (default in newer n8n versions is `true`, which blocks it)
- Postgres credential `n8n-pg-vm` (id `ieqLZNc7deNhXoPR`) points at the existing VM Postgres (`35.254.188.80`, db `n8n`, user `n8n-user`).
- Table schema:
  ```sql
  meeting_summaries (
    id BIGSERIAL PK,
    zoom_meeting_id TEXT,
    zoom_meeting_uuid TEXT UNIQUE,
    topic, host_email TEXT,
    started_at TIMESTAMPTZ,
    duration_min INTEGER,
    recording_url, transcript, summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
  Inserts use `ON CONFLICT (zoom_meeting_uuid) DO NOTHING` so Zoom retries don't duplicate rows.

## Common ops commands

```bash
gcloud config set project n8n-test-496616

# Cloud Run logs
gcloud run services logs read n8n --region=us-central1 --limit=100

# SSH into the Postgres VM
gcloud compute ssh n8n-pg-vm --zone=us-central1-a
gcloud compute ssh n8n-pg-vm --zone=us-central1-a --command='sudo docker logs n8n-postgres --tail=100'

# Read a secret (e.g. for psql)
gcloud secrets versions access latest --secret=n8n-db-password

# Update Cloud Run env vars
gcloud run services update n8n --region=us-central1 --update-env-vars="KEY=VAL"

# Re-deploy with a new image tag (n8n upgrades)
gcloud run services update n8n --region=us-central1 --image=n8nio/n8n:latest
```

## Postgres on the VM

The container `n8n-postgres` (image `postgres:15`) runs with `--restart=always`, data on `/var/lib/n8n-postgres-data` (host bind mount on the VM). To upgrade or restart Postgres, SSH in and use `sudo docker ...` directly — there's no compose file on the VM yet.

## Org policy overrides scoped to this project

Two inherited org policies blocked the deploy and were overridden at the **project** level (org-level untouched):
- `constraints/compute.vmExternalIpAccess` → `allowAll: true` (VM external IP)
- `constraints/iam.allowedPolicyMemberDomains` → `allowAll: true` (so `allUsers` can have `run.invoker`)

If a future audit needs them locked back down: delete the project policies to re-inherit from org, or replace with explicit allow-lists.

## Cost shape

Free tier covers the VM + 30GB disk + ~2M Cloud Run requests/mo. Active cost is Secret Manager (~$0.12/mo) and any egress/runtime above free tier. Cold start ~10–20s after idle since Cloud Run scales to zero — add `--min-instances=1` (~$5–10/mo) if Telegram trigger latency matters.

## MCP server

The `n8n-mcp` MCP server is configured locally (per-project) to point at the Cloud Run URL with an API key generated in n8n → Settings → API. Reconfigure with:

```bash
claude mcp get n8n-mcp                # view current config
claude mcp remove n8n-mcp -s local    # remove
claude mcp add n8n-mcp \
  -e N8N_API_URL=https://n8n-344511854894.us-central1.run.app \
  -e N8N_API_KEY=<key> \
  -e MCP_MODE=stdio -e LOG_LEVEL=error -e DISABLE_CONSOLE_OUTPUT=true -e WEBHOOK_SECURITY_MODE=moderate \
  -- npx n8n-mcp
```
