#!/usr/bin/env bash
# Wolf Cup — deliberate production deploy script
# Run manually: ./deploy.sh
# NOT wired to CI — deployment is always a conscious human action

set -euo pipefail

REMOTE_HOST="${DEPLOY_HOST:-wolf.dagle.cloud}"
# stollie1997 is the canonical deploy user post-VPS-hardening (2026-04-26):
# root SSH disabled, stollie1997 has sudo + docker group, owns /opt/wolf-cup.
# See ~/.claude/projects/D--wolf-cup/memory/reference_hostinger_vps.md for
# the full hardening notes (firewall, fail2ban, unattended-upgrades).
REMOTE_USER="${DEPLOY_USER:-stollie1997}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/wolf-cup}"

# ── Preflight: only deploy code that is pushed to master AND CI-green ────────
# Lesson (2026-06-02): a local incremental `tsc` passed while the clean Docker
# build failed, so the first deploy aborted mid-build. The VPS deploys
# origin/master via `git pull`, so guard that (a) local HEAD == origin/master
# (what actually ships) and (b) CI validated that exact commit. Emergency
# override: SKIP_PREFLIGHT=1 ./deploy.sh
if [[ "${SKIP_PREFLIGHT:-0}" != "1" ]]; then
  echo "🔎 Preflight — verifying push state + CI…"
  git fetch origin master --quiet
  LOCAL_HEAD="$(git rev-parse HEAD)"
  ORIGIN_MASTER="$(git rev-parse origin/master)"
  if [[ "${LOCAL_HEAD}" != "${ORIGIN_MASTER}" ]]; then
    echo "❌ HEAD (${LOCAL_HEAD:0:7}) != origin/master (${ORIGIN_MASTER:0:7})."
    echo "   The VPS deploys origin/master — push your commit to master first."
    echo "   (Override: SKIP_PREFLIGHT=1 ./deploy.sh)"
    exit 1
  fi
  if command -v gh >/dev/null 2>&1; then
    CI_STATE="$(gh run list --branch master --limit 15 \
      --json headSha,status,conclusion \
      --jq "map(select(.headSha==\"${LOCAL_HEAD}\")) | .[0] | (.status + \"/\" + (.conclusion // \"none\"))" \
      2>/dev/null || echo "")"
    case "${CI_STATE}" in
      completed/success)
        echo "✅ CI green for ${LOCAL_HEAD:0:7}." ;;
      completed/*)
        echo "❌ CI not green for ${LOCAL_HEAD:0:7} (${CI_STATE}). Fix it or override."
        exit 1 ;;
      *)
        echo "⚠️  No completed CI run for ${LOCAL_HEAD:0:7} (state: ${CI_STATE:-none})."
        echo "   Wait for CI to finish, or override with SKIP_PREFLIGHT=1."
        exit 1 ;;
    esac
  else
    echo "⚠️  gh CLI not found — skipped CI check (push-state verified)."
  fi
fi

echo "🐺 Wolf Cup Deploy — target: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo "⚠️  Only deploy when no active round is in progress."
echo "Press Ctrl+C within 5 seconds to abort..."
sleep 5

echo "🚀 Deploying to ${REMOTE_HOST}..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "cd '${REMOTE_DIR}' && git pull && docker compose up -d --build"

echo "✅ Deploy complete — migrations + seed ran automatically on container start."
