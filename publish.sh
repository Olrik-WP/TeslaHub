#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[TeslaHub]${NC} $1"; }
warn() { echo -e "${YELLOW}[TeslaHub]${NC} $1"; }
err()  { echo -e "${RED}[TeslaHub]${NC} $1"; }

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
log "Last published version: $LAST_TAG"
echo ""

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  err "You have uncommitted changes. Commit or stash them first."
  git status --short
  exit 1
fi

# Check we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  warn "You are on branch '$BRANCH', not 'main'. Continue? (y/N)"
  read -r CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

# Sync with remote — never push commits from this machine
log "Checking sync with remote..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  log "In sync with origin/$BRANCH ($(git rev-parse --short HEAD))"
elif git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  log "Local is behind remote, pulling..."
  git pull --ff-only origin "$BRANCH"
  log "Pulled to $(git rev-parse --short HEAD)"
else
  err "Local has commits not on GitHub. This machine must not push commits."
  err "Push your commits from Windows first, then re-run this script."
  git log "origin/$BRANCH..HEAD" --oneline
  exit 1
fi

# Ask for version
echo -n "New version (e.g. 1.2.0): v"
read -r VERSION

if [ -z "$VERSION" ]; then
  err "No version provided."
  exit 1
fi

TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  err "Tag $TAG already exists."
  exit 1
fi

# Confirm
echo ""
log "This will:"
echo "  1. Create tag $TAG on commit $(git rev-parse --short HEAD)"
echo "  2. Push tag → triggers GitHub Actions → Docker Hub build"
echo ""
echo -n "Proceed? (y/N) "
read -r CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# Create and push tag only (commits already on GitHub)
log "Creating tag $TAG..."
git tag "$TAG"
git push origin "$TAG"

echo ""
log "Tag $TAG pushed!"
log "GitHub Actions is now building the Docker images."
log "Monitor: https://github.com/Olrik-WP/TeslaHub/actions"
echo ""
log "Once built, users update with:"
echo "  docker compose pull teslahub-init teslahub-api teslahub-web"
echo "  docker compose up -d"
