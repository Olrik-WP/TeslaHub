#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[TeslaHub]${NC} $1"; }
warn() { echo -e "${YELLOW}[TeslaHub]${NC} $1"; }
err()  { echo -e "${RED}[TeslaHub]${NC} $1"; }

# ── Parse arguments ──────────────────────────────────────────────
CLEAN=false
FULL_CLEAN=false
LOGS=false

for arg in "$@"; do
  case $arg in
    --clean)      CLEAN=true ;;
    --full-clean) FULL_CLEAN=true ;;
    --logs)       LOGS=true ;;
    --help|-h)
      echo "Usage: ./update.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --clean        Remove old/dangling Docker images after build"
      echo "  --full-clean   Aggressive cleanup: prune all unused images + build cache"
      echo "  --logs         Show TeslaHub logs after restart"
      echo "  --help         Show this help"
      exit 0
      ;;
    *)
      err "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# ── Check .env exists ────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  err ".env file not found in $SCRIPT_DIR"
  err "Copy your .env file here: cp ~/teslamate/.env $SCRIPT_DIR/.env"
  exit 1
fi

# ── Show disk usage before ───────────────────────────────────────
DISK_BEFORE=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)
log "Docker disk usage before: ${DISK_BEFORE:-unknown}"

# ── Pull latest code ─────────────────────────────────────────────
log "Pulling latest code from git..."
git pull --ff-only

# ── Stop TeslaHub containers before rebuild ──────────────────────
log "Stopping TeslaHub services..."
docker compose stop teslahub-api teslahub-web 2>/dev/null || true
docker compose rm -f teslahub-api teslahub-web 2>/dev/null || true

# ── Build TeslaHub containers ────────────────────────────────────
log "Building TeslaHub API and Web..."
docker compose build teslahub-api teslahub-web

# ── Start everything ─────────────────────────────────────────────
log "Starting all services..."
docker compose up -d

# ── Wait for API health ──────────────────────────────────────────
log "Waiting for API health check..."
API_PORT=$(docker compose port teslahub-api 8080 2>/dev/null | cut -d: -f2 || echo "4001")
HEALTHY=false
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${API_PORT}/api/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 2
done

if $HEALTHY; then
  log "API is healthy!"
else
  warn "API did not respond after 30s — check logs:"
  warn "  docker compose logs teslahub-api --tail 30"
fi

# ── Cleanup ──────────────────────────────────────────────────────
if $FULL_CLEAN; then
  log "Full cleanup: pruning all unused images and build cache..."
  docker image prune -af --filter "until=24h"
  docker builder prune -af
elif $CLEAN; then
  log "Cleaning dangling images..."
  docker image prune -f
fi

# ── Show disk usage after ────────────────────────────────────────
DISK_AFTER=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)
log "Docker disk usage after: ${DISK_AFTER:-unknown}"

# ── Optionally show logs ─────────────────────────────────────────
if $LOGS; then
  log "Showing TeslaHub logs (Ctrl+C to exit)..."
  docker compose logs -f teslahub-api teslahub-web --tail 30
fi

log "Update complete!"
