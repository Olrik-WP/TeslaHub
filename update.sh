#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.addon.yml"

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
      echo "This script updates TeslaHub WITHOUT touching your TeslaMate stack."
      echo "It uses docker-compose.addon.yml which connects to the existing"
      echo "TeslaMate network. Your TeslaMate data is never affected."
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
  echo ""
  echo "Create it with your TeslaHub credentials:"
  echo ""
  echo "  cat > $SCRIPT_DIR/.env << 'EOF'"
  echo "  TESLAHUB_READER_PASS=your_reader_password"
  echo "  TESLAHUB_APP_PASS=your_app_password"
  echo "  TESLAHUB_ADMIN_USER=admin"
  echo "  TESLAHUB_ADMIN_PASSWORD=your_admin_password"
  echo "  TESLAHUB_JWT_SECRET=$(openssl rand -hex 32)"
  echo "  TZ=Europe/Paris"
  echo "  EOF"
  exit 1
fi

# ── Check TeslaMate network exists ───────────────────────────────
TM_NETWORK="${TESLAMATE_NETWORK:-teslamate_default}"
if ! docker network inspect "$TM_NETWORK" > /dev/null 2>&1; then
  err "TeslaMate network '$TM_NETWORK' not found."
  err "Make sure TeslaMate is running: cd ~/teslamate && docker compose up -d"
  err ""
  err "If your TeslaMate network has a different name, set it:"
  err "  export TESLAMATE_NETWORK=yournetwork_default"
  exit 1
fi

log "TeslaMate network '$TM_NETWORK' found — your TeslaMate data is safe."

# ── Show disk usage before ───────────────────────────────────────
DISK_BEFORE=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)
log "Docker disk usage before: ${DISK_BEFORE:-unknown}"

# ── Pull latest code ─────────────────────────────────────────────
log "Pulling latest code from git..."
git pull --ff-only

# ── Stop TeslaHub containers before rebuild ──────────────────────
log "Stopping TeslaHub services..."
docker compose -f "$COMPOSE_FILE" stop 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" rm -f 2>/dev/null || true

# ── Build TeslaHub containers ────────────────────────────────────
log "Building TeslaHub API and Web..."
docker compose -f "$COMPOSE_FILE" build

# ── Start TeslaHub ───────────────────────────────────────────────
log "Starting TeslaHub services..."
docker compose -f "$COMPOSE_FILE" up -d

# ── Wait for API health ──────────────────────────────────────────
log "Waiting for API health check..."
HEALTHY=false
for i in $(seq 1 15); do
  if curl -sf http://localhost:4001/api/health > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 2
done

if $HEALTHY; then
  log "API is healthy!"
else
  warn "API did not respond after 30s — check logs:"
  warn "  docker compose -f $COMPOSE_FILE logs teslahub-api --tail 30"
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
  docker compose -f "$COMPOSE_FILE" logs -f --tail 30
fi

log "Update complete!"
