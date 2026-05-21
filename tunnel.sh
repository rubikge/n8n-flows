#!/usr/bin/env bash

COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.yml"
TUNNEL_LOG="/tmp/localtunnel.log"
HEALTH_INTERVAL=15
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
  pkill -f "localtunnel" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"

  echo "[tunnel] Starting localtunnel..."
  npx localtunnel --port 5678 > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  local url=""
  for i in $(seq 1 20); do
    url=$(grep -o 'https://[^ ]*\.loca\.lt' "$TUNNEL_LOG" 2>/dev/null | head -1)
    [ -n "$url" ] && break
    sleep 0.5
  done

  if [ -z "$url" ]; then
    echo "[tunnel] ERROR: failed to get URL"
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

# ── Main loop ────────────────────────────────────────────────────────────────

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
