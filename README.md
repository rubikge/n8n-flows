# n8n on Google Cloud Run

Ops repo for an n8n setup deployed on Google Cloud Run, with Postgres on a free-tier `e2-micro` Compute Engine VM. Hosts the **Angie** Telegram AI workflow, its error-trigger sibling, and a **Zoom recording → summary** pipeline.

- **prod URL:** https://n8n-344511854894.us-central1.run.app
- **GCP project:** `n8n-test-496616` (region `us-central1`)

Workflow definitions live in [`workflows/`](workflows/) and are the source of truth. CI/CD pushes them to live n8n via the REST API.

## Repo layout

```
n8n-docker/
├── workflows/                  # source of truth — one JSON per workflow + manifest.json
├── scripts/                    # deploy.mjs (repo -> n8n) and export.mjs (n8n -> repo)
├── .github/workflows/          # deploy-dev.yml, deploy-prod.yml
├── CLAUDE.md                   # detailed ops guide + GCP resource map (read this)
├── CHANGELOG.md
├── package.json                # Node 20, scripts: export / deploy / deploy:dry
└── .claude/                    # Claude Code permissions for this project
```

## CI/CD

| Branch / event | Deploys to |
|---|---|
| Pull request, push to any non-`main` branch | dev (`n8n-dev`) |
| Push to `main` | prod (`n8n`) |

Required GitHub Actions secrets: `N8N_DEV_URL`, `N8N_DEV_API_KEY`, `N8N_PROD_URL`, `N8N_PROD_API_KEY`.

## Editing workflows

Two safe paths:

1. **From a feature branch (recommended).** Edit `workflows/*.json` directly, push, open a PR — CI deploys to dev for you to verify. Merge → CI deploys to prod.
2. **Build in the dev n8n UI, then export.** Develop interactively in dev, then run `N8N_URL=$DEV_URL N8N_API_KEY=$DEV_KEY node scripts/export.mjs` locally to update `workflows/*.json`, commit, PR, merge.

**Do not edit workflows in the prod UI.** Each prod deploy overwrites them. If someone has, run `node scripts/export.mjs` against prod immediately to capture the change, then commit.

## First-time setup

The dev environment (`n8n-dev` Cloud Run service, `n8n_dev` Postgres DB, dev credentials, dev Telegram bot) is provisioned manually — see the runbook in [CLAUDE.md](CLAUDE.md#provisioning-the-dev-environment-runbook). It's one-time and stays out of CI to keep blast radius small.

## Quick ops

```bash
gcloud config set project n8n-test-496616

# tail Cloud Run logs
gcloud run services logs read n8n     --region=us-central1 --limit=100
gcloud run services logs read n8n-dev --region=us-central1 --limit=100

# SSH into the Postgres VM
gcloud compute ssh n8n-pg-vm --zone=us-central1-a

# tail Postgres container logs
gcloud compute ssh n8n-pg-vm --zone=us-central1-a --command='sudo docker logs n8n-postgres --tail=100'
```

See [CLAUDE.md](CLAUDE.md) for the full resource inventory, env vars, IAM bindings, project-level org policy overrides, and the dev provisioning runbook.

## Deployment background

Deployed 2026-05-24 following the [n8n Cloud Run guide (durable mode)](https://docs.n8n.io/hosting/installation/server-setups/google-cloud-run/), substituting Postgres on a free-tier `e2-micro` VM in place of Cloud SQL to stay near $0/month.
