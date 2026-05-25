#!/usr/bin/env bash
# Syncs a single changed file from this Mac to the Windows host (winbackend) via scp + sshpass.
# Invoked by the PostToolUse hook in .claude/settings.json after every Edit/Write/MultiEdit.
#
# Sync rules (first match wins):
#   1. birdss_backend/dataset/rag/  →  same path on Windows (rag service code)
#   2. birdss_backend/dataset/      →  SKIP (excludes large data files like the 774MB CSV)
#   3. birdss_backend/              →  same path on Windows (FastAPI backend)
#   4. Birdss/                      →  same path on Windows (Vite frontend)
# Anything outside these roots, plus noise (__pycache__, node_modules, .venv, etc.), is skipped.

set -u

REPO_ROOT="/Users/dikshitbhatta/Desktop/eco"
REMOTE_HOST="winbackend"
# Windows SFTP path: /C:/... ; PowerShell path: C:\... ; 8.3 short name avoids the space in "Swarnim Bajracharya".
REMOTE_SFTP_BASE="/C:/Users/SWARNI~1/eco"
REMOTE_WIN_BASE="C:\\Users\\SWARNI~1\\eco"
PASS_FILE="$HOME/.ssh/winbackend-pass"
LOG_FILE="$REPO_ROOT/.claude/sync.log"

INPUT="$(cat || true)"
FILE_PATH="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

# Skip noise that should never sync.
case "$FILE_PATH" in
  *"/__pycache__/"*|*.pyc|*"/.venv/"*|*"/.pytest_cache/"*|*"/node_modules/"*|*"/.next/"*|*"/dist/"*|*"/.vite/"*|*"/faiss_store.bak/"*)
    exit 0 ;;
esac

# Apply sync rules — sets REL_PATH (relative to REPO_ROOT). Empty REL_PATH = skip.
REL_PATH=""
case "$FILE_PATH" in
  "$REPO_ROOT/birdss_backend/dataset/rag/"*)
    REL_PATH="${FILE_PATH#$REPO_ROOT/}" ;;
  "$REPO_ROOT/birdss_backend/dataset/"*)
    exit 0 ;;  # Skip everything else under dataset/ (big files).
  "$REPO_ROOT/birdss_backend/"*)
    REL_PATH="${FILE_PATH#$REPO_ROOT/}" ;;
  "$REPO_ROOT/Birdss/"*)
    REL_PATH="${FILE_PATH#$REPO_ROOT/}" ;;
  *)
    exit 0 ;;  # File isn't in a synced root.
esac

# Skip files over 5 MB — code edits are tiny; this guards against accidentally syncing data dumps.
if [ -f "$FILE_PATH" ]; then
  SIZE=$(stat -f%z "$FILE_PATH" 2>/dev/null || stat -c%s "$FILE_PATH" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 5242880 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] skipped (>5MB): $REL_PATH" >> "$LOG_FILE"
    exit 0
  fi
fi

REMOTE_SFTP_PATH="$REMOTE_SFTP_BASE/$REL_PATH"
REL_DIR="$(dirname "$REL_PATH")"
REMOTE_WIN_DIR="$REMOTE_WIN_BASE\\${REL_DIR//\//\\}"

{
  echo "----"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] change: $REL_PATH"
} >> "$LOG_FILE"

# Ensure parent dir exists on Windows (Windows path format for PowerShell).
sshpass -f "$PASS_FILE" ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
  "$REMOTE_HOST" \
  "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force -Path '$REMOTE_WIN_DIR' | Out-Null\"" \
  >> "$LOG_FILE" 2>&1

# Copy the file (SFTP path format for scp).
sshpass -f "$PASS_FILE" scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
  "$FILE_PATH" "$REMOTE_HOST:$REMOTE_SFTP_PATH" \
  >> "$LOG_FILE" 2>&1

STATUS=$?
if [ $STATUS -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] sync ok" >> "$LOG_FILE"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] sync FAILED (scp exit $STATUS)" >> "$LOG_FILE"
fi

exit 0
