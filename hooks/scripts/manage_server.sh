#!/usr/bin/env bash
# MCP stdio server for Claude Observe plugin.
# Manages a persistent Docker container that runs the observe server.
# The container survives session ends — the dashboard stays available.

set -euo pipefail

CONTAINER_NAME="claude-observe"
IMAGE="ghcr.io/simple10/claude-observe:latest"
PORT=4981
DATA_DIR="$HOME/.claude-observe/data"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

log() { echo "[claude-observe] $*" >&2; }

# ── Preflight checks ─────────────────────────────────────

if ! command -v docker &>/dev/null; then
  log "ERROR: Docker is not installed or not in PATH"
  log "Install Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  log "ERROR: Docker daemon is not running"
  log "Start Docker and restart Claude Code"
  exit 1
fi

# ── Health check ──────────────────────────────────────────

health_check() {
  curl -sf "$HEALTH_URL" >/dev/null 2>&1
}

# ── Start container if needed ─────────────────────────────

if health_check; then
  log "Server already running on port ${PORT}"
else
  # Ensure data directory exists
  mkdir -p "$DATA_DIR"

  # Check for stopped container — remove it so we always use the latest image
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "Removing stopped container to pull latest image..."
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1
  fi

  log "Pulling image and starting container..."
  docker pull "$IMAGE" 2>&1 | tail -1 >&2
  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PORT}:${PORT}" \
    -e "SERVER_PORT=${PORT}" \
    -e "DB_PATH=/data/observe.db" \
    -e "CLIENT_DIST_PATH=/app/client/dist" \
    -e "ENABLE_WEBSOCKET=true" \
    -v "${DATA_DIR}:/data" \
    "$IMAGE" >/dev/null

  # Wait for health check
  log "Waiting for server to start..."
  for i in $(seq 1 15); do
    if health_check; then
      break
    fi
    if [ "$i" -eq 15 ]; then
      log "ERROR: Server failed to start within 15 seconds"
      log "Check: docker logs ${CONTAINER_NAME}"
      exit 1
    fi
    sleep 1
  done

  log "Server started successfully"
fi

log "Dashboard: http://localhost:${PORT}"

# ── Stay alive as MCP stdio server ───────────────────────
# Read stdin indefinitely so Claude Code can manage this process.
# The Docker container runs independently and persists after this exits.

cat >/dev/null 2>&1 || true
