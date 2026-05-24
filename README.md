# n8n on Google Cloud Run

Ops repo for a single n8n instance deployed on Google Cloud Run, with Postgres on a free-tier `e2-micro` Compute Engine VM. Hosts the **Angie** Telegram AI workflow.

- **Service URL:** https://n8n-344511854894.us-central1.run.app
- **GCP project:** `n8n-test-496616` (region `us-central1`)

## Repo layout

```
n8n-docker/
├── CLAUDE.md            # detailed ops guide + GCP resource map (read this)
├── CHANGELOG.md         # release history
├── angie-workflow.json  # exported Angie workflow JSON (canonical backup)
└── .claude/             # Claude Code permissions for this project
```

## Quick ops

```bash
gcloud config set project n8n-test-496616

# tail Cloud Run logs
gcloud run services logs read n8n --region=us-central1 --limit=100

# SSH into the Postgres VM
gcloud compute ssh n8n-pg-vm --zone=us-central1-a

# tail Postgres container logs
gcloud compute ssh n8n-pg-vm --zone=us-central1-a --command='sudo docker logs n8n-postgres --tail=100'
```

See [CLAUDE.md](CLAUDE.md) for the full resource inventory, env vars, IAM bindings, and project-level org policy overrides.

## Deployment background

Deployed 2026-05-24 following the [n8n Cloud Run guide (durable mode)](https://docs.n8n.io/hosting/installation/server-setups/google-cloud-run/), substituting Postgres on a free-tier `e2-micro` VM in place of Cloud SQL to stay near $0/month.
