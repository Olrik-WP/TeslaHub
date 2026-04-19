#!/bin/bash
set -e

# ── Configuration ────────────────────────────────────────────────
DEPLOY_DIR="${TESLAHUB_DEPLOY_DIR:-$(pwd)}"

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
      echo "Pulls latest TeslaHub Docker images and restarts services."
      echo "TeslaMate, Grafana, and PostgreSQL are NOT affected."
      echo ""
      echo "  Deploy dir:   $DEPLOY_DIR"
      echo ""
      echo "Options:"
      echo "  --clean        Remove dangling Docker images after update"
      echo "  --full-clean   Prune all unused images + build cache"
      echo "  --logs         Show TeslaHub logs after restart"
      echo "  --help         Show this help"
      echo ""
      echo "Environment:"
      echo "  TESLAHUB_DEPLOY_DIR   Override deploy directory (default: current dir)"
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
  err "Run this script from your TeslaMate directory, or set TESLAHUB_DEPLOY_DIR"
  exit 1
fi

log "Deploy: $DEPLOY_DIR"

# ── Show disk usage before ───────────────────────────────────────
DISK_BEFORE=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)
log "Docker disk usage before: ${DISK_BEFORE:-unknown}"

# ── Detect optional Security Alerts stack ────────────────────────
# fleet-telemetry and tesla-http-proxy are built locally from Tesla's
# source (no public Docker images). If the user has them declared and
# Security Alerts is enabled, include them in the rebuild cycle so the
# latest Tesla code is used.
cd "$DEPLOY_DIR"

EXTRA_BUILD=""
EXTRA_SERVICES=""
if grep -qE '^\s*SECURITY_ALERTS_ENABLED\s*=\s*true' "$DEPLOY_DIR/.env" 2>/dev/null; then
  AVAILABLE_SERVICES=$(docker compose config --services 2>/dev/null)
  for svc in fleet-telemetry tesla-http-proxy-init tesla-http-proxy; do
    if echo "$AVAILABLE_SERVICES" | grep -qx "$svc"; then
      EXTRA_SERVICES="$EXTRA_SERVICES $svc"
      if [ "$svc" != "tesla-http-proxy-init" ]; then
        EXTRA_BUILD="$EXTRA_BUILD $svc"
      fi
    fi
  done
  if [ -n "$EXTRA_BUILD" ]; then
    log "Security Alerts enabled — rebuilding from local source:$EXTRA_BUILD"
    for src in fleet-telemetry-src vehicle-command-src; do
      if [ -d "$DEPLOY_DIR/$src/.git" ]; then
        log "Pulling latest Tesla source: $src"
        git -C "$DEPLOY_DIR/$src" pull --ff-only || warn "$src git pull failed — continuing with current sources."
      fi
    done
  fi
fi

# ── Pull latest images ───────────────────────────────────────────
log "Pulling latest TeslaHub images..."
docker compose pull teslahub-init teslahub-api teslahub-web

if [ -n "$EXTRA_BUILD" ]; then
  log "Building Security Alerts services from source:$EXTRA_BUILD"
  docker compose build $EXTRA_BUILD
fi

# ── Restart only TeslaHub ────────────────────────────────────────
log "Restarting TeslaHub services..."
docker compose up -d teslahub-init teslahub-api teslahub-web $EXTRA_SERVICES

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

log "Update complete!"
