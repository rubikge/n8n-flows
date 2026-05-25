# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repo manages an n8n setup deployed on **Google Cloud Run** across two environments:

- **prod** (`n8n`) — source of truth for live workflows
- **dev** (`n8n-dev`) — staging instance, mirrors prod's shape

`workflows/*.json` is the **source of truth** for workflow definitions. GitHub Actions pushes those JSONs into n8n via the REST API: feature branches/PRs deploy to dev, merges to `main` deploy to prod. Editing workflows directly in the prod n8n UI is unsafe — the next deploy will overwrite your changes.

The `n8n-mcp` MCP server is configured to talk to **dev** (`n8n-dev`), so `mcp__n8n-mcp__n8n_*` tools operate on n8n-dev workflows. Prod is never touched by MCP — it only changes via `deploy-prod.yml` on merge to `main`. There are no tests or linters — this is a configuration / ops repo.

## Cloud n8n

| Resource | prod | dev |
|---|---|---|
| Cloud Run service | `n8n` → https://n8n-344511854894.us-central1.run.app | `n8n-dev` (provision per runbook) |
| Postgres database (on VM `n8n-pg-vm`) | `n8n` | `n8n_dev` |
| Encryption-key secret | `n8n-encryption-key` | `n8n-encryption-key-dev` |
| Telegram bot | "Yarik Bot" (prod chat) | dev BotFather bot |
| Zoom Marketplace app | prod app | dev app (or skip Zoom on dev) |

Other shared resources:

| Resource | Value |
|---|---|
| GCP project | `n8n-test-496616` (project number `344511854894`) |
| Region / zone | `us-central1` / `us-central1-a` |
| VM (Postgres) | `n8n-pg-vm` (`e2-micro`, Debian 12, 30GB disk), static IP `35.254.188.80`, Postgres 15 in Docker, port 5432 |
| Service account | `n8n-service-account@n8n-test-496616.iam.gserviceaccount.com` |
| DB-password secret | `n8n-db-password` (shared by prod and dev DB users) |
| Firewall | `n8n-pg-fw`: tcp:5432 from `0.0.0.0/0` on VMs tagged `n8n-pg` |

## Workflows

| Workflow | Live ID (prod) | Purpose |
|---|---|---|
| Angie, personal AI assistant with Telegram voice and text | `GL1AZv0gEcz66PDQ` | Telegram chat-trigger AI assistant with Gmail tool access. `settings.errorWorkflow` -> Angie — Errors. |
| Angie — Errors | `oXBllR5vTjxrFECV` | Error-trigger workflow — fires when Angie main fails, sends a Telegram alert. |
| Zoom recording → summary → Telegram | `8v101lnwYq4QCjgY` | Webhook trigger on Zoom `recording.completed`: downloads M4A audio, transcribes & summarizes with Gemini 2.5 Flash, writes a row to the `meeting_summaries` Postgres table, sends summary to Telegram chat `63277017` via Yarik Bot |

The mapping from workflow `name` to `workflows/*.json` file is in `workflows/manifest.json`. Easiest path to add a new workflow: build in dev UI, then click **Execute** on the in-n8n **Publish to GitHub (develop)** workflow — it commits the new JSON and appends the manifest entry (with a slugified filename) in one go. Local alternative: `npm run export -- --url=$DEV_URL --api-key=$DEV_KEY`, then edit `manifest.json` by hand.

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

## Sync scripts (`scripts/`)

Two Node 20 scripts drive repo ↔ n8n sync. Both accept `--url=...` `--api-key=...` or read `N8N_URL` / `N8N_API_KEY` env vars.

```bash
# pull live workflows into workflows/*.json (manual; safe to run anytime)
N8N_URL=$PROD_URL N8N_API_KEY=$PROD_KEY node scripts/export.mjs

# preview a deploy (no API writes)
N8N_URL=$DEV_URL N8N_API_KEY=$DEV_KEY node scripts/deploy.mjs --dry-run

# deploy (CI uses this without flags; first-time provisioning of a new env adds --activate-on-create)
N8N_URL=$DEV_URL N8N_API_KEY=$DEV_KEY node scripts/deploy.mjs --activate-on-create
```

Deploy logic:
1. Builds `{credential name -> id}` map on the target via `GET /api/v1/credentials`. Credentials are matched **by name** — they must already exist in the target n8n UI.
2. **Pass 1**: upserts every manifest workflow without `settings.errorWorkflow`. Idempotent — no PUT if the normalized body equals the live one.
3. **Pass 2**: for any workflow that has `settings.errorWorkflowName`, looks up the target ID by name and PUTs the workflow again with `settings.errorWorkflow` set.

`active` is never toggled on update — set activation once in the UI per env. Use `--activate-on-create` for first-time provisioning. Use `--skip-dev-only` (passed by `deploy-prod.yml`) to skip manifest entries whose `tag` is `"dev-only"` — those workflows live only on n8n-dev.

## CI/CD

| Workflow | Trigger | Target | Secrets |
|---|---|---|---|
| `.github/workflows/deploy-dev.yml` | PRs and pushes to non-`main` branches | `n8n-dev` | `N8N_DEV_URL`, `N8N_DEV_API_KEY` |
| `.github/workflows/deploy-prod.yml` | push to `main`, manual dispatch | `n8n` | `N8N_PROD_URL`, `N8N_PROD_API_KEY` |

Both filter on `paths: workflows/**, scripts/**, .github/workflows/...` so doc-only changes don't trigger a deploy. `environment: production` on the prod workflow makes it visible in GitHub's Environments UI for adding manual approval gates later.

## Dev ↔ repo sync flow

Prod is one-way: the repo is the source of truth and `deploy-prod.yml` is the only path that touches the prod n8n instance.

Dev is **bidirectional** so workflows can be authored in the n8n-dev UI without the changes silently dying there:

- **repo → dev** (CI): PRs / non-main pushes trigger `deploy-dev.yml`, which runs `scripts/deploy.mjs` against `n8n-dev`.
- **dev → repo** (manual): a workflow named **"Publish to GitHub (develop)"** lives inside n8n-dev. Clicking Execute lists **every** workflow on n8n-dev via the n8n Public API, normalizes each one to repo shape, and commits any changed JSON files to the `develop` branch. Unchanged files are skipped (SHA-256 compare against the current `develop` blob). A second branch of the same run regenerates `workflows/manifest.json`: existing entries are kept by `name` and their slug, any workflow not yet in the manifest is appended with a slugified filename (`slugify(name).json`, de-duplicated), and workflows tagged `dev-only` on n8n-dev get `"tag": "dev-only"` synced into their manifest entry (added or removed as the tag state changes). The manifest commit only happens when the file actually changed. The publish workflow itself is source-controlled at `workflows/publish-to-github-develop.json`; its `manifest.json` entry carries `"tag": "dev-only"` so `deploy-prod.yml` skips it.

Recommended author loop: edit in n8n-dev UI → click **Execute** on "Publish to GitHub (develop)" → review the resulting commit(s) on `develop` → open PR `develop → main` → merge fires `deploy-prod.yml`.

Caveats:
- Do not run the publish workflow while a feature-branch `deploy-dev.yml` job is in flight. The two directions can clobber each other.
- Do not push workflow JSON edits to a feature branch while you have uncommitted edits in the n8n-dev UI — same reason.
- New workflows authored in the dev UI no longer need a pre-existing `workflows/manifest.json` entry — the publish workflow appends one on the same run. If you want a specific filename, add the manifest entry by hand first and the publish flow will honor it.

**Dev-only workflows.** Any workflow that exists only on n8n-dev (operational tooling, not part of the prod product) should be tagged `dev-only` in the n8n-dev UI. The publish workflow's "Build updated manifest" Code node detects that tag and writes `"tag": "dev-only"` onto the manifest entry; `deploy-prod.yml` then passes `--skip-dev-only` to `scripts/deploy.mjs`, which skips those entries. The publish workflow itself is the canonical example and is already tagged this way.

## Provisioning the dev environment (runbook)

One-time, manual:

```bash
gcloud config set project n8n-test-496616

# 1. Create the dev DB (SSH to the Postgres VM)
gcloud compute ssh n8n-pg-vm --zone=us-central1-a --command='sudo docker exec -i n8n-postgres psql -U n8n-user -d postgres -c "CREATE DATABASE \"n8n_dev\" OWNER \"n8n-user\";"'

# 2. Create the dev encryption-key secret
openssl rand -base64 32 | gcloud secrets create n8n-encryption-key-dev --data-file=-
gcloud secrets add-iam-policy-binding n8n-encryption-key-dev \
  --member='serviceAccount:n8n-service-account@n8n-test-496616.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'

# 3. Deploy n8n-dev Cloud Run service
#    Substitute env vars to match prod (use `gcloud run services describe n8n --region=us-central1` as the template).
gcloud run deploy n8n-dev \
  --region=us-central1 \
  --image=n8nio/n8n:latest \
  --service-account=n8n-service-account@n8n-test-496616.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars=DB_TYPE=postgresdb,DB_POSTGRESDB_HOST=35.254.188.80,DB_POSTGRESDB_PORT=5432,DB_POSTGRESDB_DATABASE=n8n_dev,DB_POSTGRESDB_USER=n8n-user,N8N_BLOCK_ENV_ACCESS_IN_NODE=false,NODE_FUNCTION_ALLOW_BUILTIN=crypto \
  --set-secrets=DB_POSTGRESDB_PASSWORD=n8n-db-password:latest,N8N_ENCRYPTION_KEY=n8n-encryption-key-dev:latest

# After deploy, also set WEBHOOK_URL to the service URL (gcloud assigns it after first deploy):
DEV_URL=$(gcloud run services describe n8n-dev --region=us-central1 --format='value(status.url)')
gcloud run services update n8n-dev --region=us-central1 --update-env-vars="WEBHOOK_URL=$DEV_URL,N8N_HOST=${DEV_URL#https://}"
```

Then in the dev n8n UI (`$DEV_URL/setup`):
1. Set up the owner account.
2. Settings → API → create an API key. Save as the `N8N_DEV_API_KEY` GitHub secret; save `$DEV_URL` as `N8N_DEV_URL`.
3. Manually create the credentials with **the same names** as prod: `Yarik Bot` (Telegram, dev BotFather token), `n8n-pg-vm` (Postgres, host `35.254.188.80`, db `n8n_dev`), `Google Gemini(PaLM) Api account`, `sergei@rubik.school` (Gmail OAuth — separate OAuth client or re-use prod's).
4. From your laptop: `N8N_URL=$DEV_URL N8N_API_KEY=$DEV_KEY node scripts/deploy.mjs --activate-on-create` — should create all three workflows and activate them.

For prod, set `N8N_PROD_URL` and `N8N_PROD_API_KEY` GitHub secrets (the prod API key is the one already in MCP config).

### Setup: dev → repo publish workflow

The workflow JSON already lives on n8n-dev as **`hE9Ui650AQIYfgKu`** (created via the n8n REST API; the source-of-truth file is checked in at `workflows/publish-to-github-develop.json` and its manifest entry carries `"tag": "dev-only"`). To finish wiring it up:

1. **GitHub**: create the `develop` branch from `main` if it doesn't exist:
   `git push origin main:develop`
2. **Cloud Run (n8n-dev)**: expose the dev API key as an env var so the workflow's HTTP Request nodes can authenticate against `localhost:5678`:
   `gcloud run services update n8n-dev --region=us-central1 --update-env-vars="N8N_DEV_API_KEY=<the dev API key>"`
3. **n8n-dev UI**: Credentials → New → search "GitHub" → type *GitHub - Access Token*. Name it exactly **`GitHub — n8n backup`** (em dash). Token = a fine-grained PAT scoped to **Contents: read/write** on `rubikge/n8n-flows` only.
4. **n8n-dev UI**: open the **Publish to GitHub (develop)** workflow. The credential was POSTed by name only — open each GitHub node (`Get manifest.json`, `Get existing file`, `Create file on develop`, `Edit file on develop`, `Edit manifest.json`) and pick `GitHub — n8n backup` from the credential dropdown. Save. Activation not needed — the manual trigger fires regardless.
5. **n8n-dev UI**: create a tag named exactly `dev-only` (Settings → Tags) and apply it to this workflow. The workflow's "Build updated manifest" node detects this tag and writes `"tag": "dev-only"` on the manifest entry it commits, which keeps the entry out of prod deploys via `--skip-dev-only`. Without this tag, the workflow re-adds itself to `workflows/manifest.json` without the dev-only marker and the next prod deploy crashes on the missing credential.

To run a publish: open the workflow in n8n-dev and click **Execute**. Each changed workflow file becomes one commit on `develop` with message `n8n-dev backup: <filename>`; if any new workflows are appended to `workflows/manifest.json`, that file gets its own commit (`n8n-dev backup: update manifest.json`) in the same run.

If the workflow ever needs to be re-imported from scratch (e.g. dev was rebuilt), import `workflows/publish-to-github-develop.json` via the UI or POST it via the n8n REST API (`POST /api/v1/workflows`), then repeat steps 4 and 5.

## Common ops commands

```bash
gcloud config set project n8n-test-496616

# Cloud Run logs
gcloud run services logs read n8n     --region=us-central1 --limit=100
gcloud run services logs read n8n-dev --region=us-central1 --limit=100

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

The `n8n-mcp` MCP server is configured locally (per-project) to point at the **n8n-dev** Cloud Run URL (`https://n8n-dev-dpcbzmoa5a-uc.a.run.app`) with the dev API key. Pointing MCP at dev keeps experiments off prod — prod is only touched by `deploy-prod.yml` on merge to `main`. Reconfigure with:

```bash
claude mcp get n8n-mcp                # view current config
claude mcp remove n8n-mcp -s local    # remove
claude mcp add n8n-mcp \
  -e N8N_API_URL=https://n8n-dev-dpcbzmoa5a-uc.a.run.app \
  -e N8N_API_KEY=<dev key> \
  -e MCP_MODE=stdio -e LOG_LEVEL=error -e DISABLE_CONSOLE_OUTPUT=true -e WEBHOOK_SECURITY_MODE=moderate \
  -- npx n8n-mcp
```
