#!/bin/bash
set -e

# ── Configuration ────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="${TESLAHUB_DEPLOY_DIR:-$HOME/teslamate}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[TeslaHub-Dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[TeslaHub-Dev]${NC} $1"; }
err()  { echo -e "${RED}[TeslaHub-Dev]${NC} $1"; }

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
      echo "Usage: ./update-dev.sh [OPTIONS]"
      echo ""
      echo "Pulls latest code from git, rebuilds and restarts TeslaHub."
      echo "For developers/contributors only. End users should use update.sh."
      echo ""
      echo "  Source repo:  $REPO_DIR"
      echo "  Deploy dir:   $DEPLOY_DIR"
      echo ""
      echo "Options:"
      echo "  --clean        Remove dangling Docker images after build"
      echo "  --full-clean   Prune all unused images + build cache"
      echo "  --logs         Show TeslaHub logs after restart"
      echo "  --help         Show this help"
      echo ""
      echo "Environment:"
      echo "  TESLAHUB_DEPLOY_DIR   Override deploy directory (default: ~/teslamate)"
      exit 0
      ;;
    *)
      err "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# ── Checks ───────────────────────────────────────────────────────
if [ ! -f "$DEPLOY_DIR/docker-compose.yml" ]; then
  err "docker-compose.yml not found in $DEPLOY_DIR"
  err "Set TESLAHUB_DEPLOY_DIR to your teslamate directory"
  exit 1
fi

log "Source: $REPO_DIR"
log "Deploy: $DEPLOY_DIR"

# ── Show disk usage before ───────────────────────────────────────
DISK_BEFORE=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)
log "Docker disk usage before: ${DISK_BEFORE:-unknown}"

# ── Pull latest code ─────────────────────────────────────────────
log "Pulling latest code..."
cd "$REPO_DIR"
git -c core.fileMode=false pull --ff-only

# ── Detect optional Security Alerts stack ────────────────────────
# If the user enabled SECURITY_ALERTS_ENABLED=true and declared a
# fleet-telemetry service in their compose, include it in the rebuild
# cycle so it stays in sync with TeslaHub.
cd "$DEPLOY_DIR"

EXTRA_SERVICES=""
if docker compose config --services 2>/dev/null | grep -qx "fleet-telemetry"; then
  if grep -qE '^\s*SECURITY_ALERTS_ENABLED\s*=\s*true' "$DEPLOY_DIR/.env" 2>/dev/null; then
    EXTRA_SERVICES="fleet-telemetry"
    log "Security Alerts enabled — fleet-telemetry will be rebuilt too."
  else
    log "fleet-telemetry service detected but SECURITY_ALERTS_ENABLED is not 'true' — skipping it."
  fi
fi

# ── Rebuild and restart TeslaHub (and fleet-telemetry if enabled) ──

log "Stopping TeslaHub services..."
docker compose stop teslahub-api teslahub-web $EXTRA_SERVICES 2>/dev/null || true
docker compose rm -f teslahub-api teslahub-web $EXTRA_SERVICES 2>/dev/null || true

APP_VERSION=$(cd "$REPO_DIR" && git describe --tags --always 2>/dev/null || echo "dev")
log "Building TeslaHub API and Web (version: $APP_VERSION)..."
docker compose build --build-arg APP_VERSION="$APP_VERSION" teslahub-api teslahub-web

if [ -n "$EXTRA_SERVICES" ]; then
  log "Building fleet-telemetry from source..."
  docker compose build $EXTRA_SERVICES
fi

log "Starting TeslaHub services..."
docker compose up -d teslahub-api teslahub-web $EXTRA_SERVICES

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
  warn "  cd $DEPLOY_DIR && docker compose logs teslahub-api --tail 30"
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
  cd "$DEPLOY_DIR"
  docker compose logs -f teslahub-api teslahub-web $EXTRA_SERVICES --tail 30
fi

log "Dev update complete!"
