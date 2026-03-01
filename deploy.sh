#!/usr/bin/env bash
# Wolf Cup — deliberate production deploy script
# Run manually: ./deploy.sh
# NOT wired to CI — deployment is always a conscious human action

set -euo pipefail

REMOTE_HOST="${DEPLOY_HOST:-wolf.dagle.cloud}"
REMOTE_USER="${DEPLOY_USER:-deploy}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/wolf-cup}"

echo "🐺 Wolf Cup Deploy — target: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo "⚠️  Only deploy when no active round is in progress."
echo "Press Ctrl+C within 5 seconds to abort..."
sleep 5

echo "🚀 Deploying to ${REMOTE_HOST}..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "cd '${REMOTE_DIR}' && git pull && docker compose up -d --build"

echo "✅ Deploy complete — migrations + seed ran automatically on container start."
