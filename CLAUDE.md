# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo manages a single n8n instance running on **Google Cloud Run**. The Angie Telegram-AI workflow lives there. The `n8n-mcp` MCP server is configured to talk to this instance, so MCP tools (`mcp__n8n-mcp__n8n_*`) operate directly on the cloud workflow.

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

`angie-workflow.json` is a checked-in export of the Angie workflow (no credentials embedded). The live workflow on Cloud Run is the source of truth; the JSON is a backup / reference for diffs and restores.

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
