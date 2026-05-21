#!/usr/bin/env bash
#
# Usage:
#   ./tunnel.sh           — start with cloudflared tunnel (default)
#   ./tunnel.sh local     — start without tunnel (localhost only)

MODE="${1:-tunnel}"

COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.yml"
TUNNEL_LOG="/tmp/cloudflared.log"
HEALTH_INTERVAL=30
TUNNEL_PID=""
CURRENT_URL=""

cleanup() {
  echo ""
  echo "[tunnel] Shutting down..."
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

start_tunnel() {
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"

  echo "[tunnel] Starting cloudflared..."
  cloudflared tunnel --url http://localhost:5678 > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  local url=""
  for i in $(seq 1 40); do
    url=$(grep -o 'https://[^ ]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    [ -n "$url" ] && break
    sleep 0.5
  done

  if [ -z "$url" ]; then
    echo "[tunnel] ERROR: failed to get URL. cloudflared output:"
    cat "$TUNNEL_LOG"
    TUNNEL_PID=""
    return 1
  fi

  echo "[tunnel] URL: $url (pid=$TUNNEL_PID)"
  CURRENT_URL="$url"
  return 0
}

update_and_restart_n8n() {
  sed -i "s|WEBHOOK_URL=.*|WEBHOOK_URL=${CURRENT_URL}|" "$COMPOSE_FILE"
  echo "[n8n] Restarting with WEBHOOK_URL=${CURRENT_URL}"
  docker compose -f "$COMPOSE_FILE" down --timeout 5 2>&1 | tail -1
  docker compose -f "$COMPOSE_FILE" up -d 2>&1 | tail -1
  echo "[n8n] Ready at http://localhost:5678"
}

is_tunnel_alive() {
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "[tunnel] Process $TUNNEL_PID died"
    return 1
  fi
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$CURRENT_URL" 2>/dev/null)
  if [ "$status" = "000" ] || [ "$status" = "503" ]; then
    echo "[tunnel] Health check failed (HTTP $status)"
    return 1
  fi
  return 0
}

# ── Local mode ────────────────────────────────────────────────────────────────

if [ "$MODE" = "local" ]; then
  CURRENT_URL="http://localhost:5678"
  update_and_restart_n8n
  echo "[n8n] Running in local mode. Webhooks will not be reachable from the internet."
  exit 0
fi

# ── Tunnel mode (default) ─────────────────────────────────────────────────────

while true; do
  if ! start_tunnel; then
    echo "[tunnel] Retrying in 5s..."
    sleep 5
    continue
  fi

  update_and_restart_n8n

  while true; do
    sleep "$HEALTH_INTERVAL"
    if ! is_tunnel_alive; then
      echo "[tunnel] Restarting..."
      break
    fi
    echo "[tunnel] OK — ${CURRENT_URL}"
  done
done
