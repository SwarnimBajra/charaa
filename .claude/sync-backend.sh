#!/usr/bin/env bash
# Syncs a single changed file from birdss_backend/ to the Windows host (winbackend) via scp + sshpass.
# Invoked by the PostToolUse hook in .claude/settings.json after every Edit/Write/MultiEdit.
# Non-backend edits are a no-op.

set -u

REPO_ROOT="/Users/dikshitbhatta/Desktop/eco"
LOCAL_PREFIX="$REPO_ROOT/birdss_backend/"
REMOTE_HOST="winbackend"
# Windows OpenSSH SFTP path format is /C:/... (capital, colon).
# Also use 8.3 short name (SWARNI~1) for the user folder — paths with spaces get truncated by cmd.exe.
REMOTE_BASE="/C:/Users/SWARNI~1/eco/birdss_backend"
PASS_FILE="$HOME/.ssh/winbackend-pass"
LOG_FILE="$REPO_ROOT/.claude/sync.log"

# Hook input arrives as JSON on stdin: { "tool_name": "...", "tool_input": { "file_path": "..." }, ... }
INPUT="$(cat || true)"
FILE_PATH="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

# Skip if edit isn't under birdss_backend/.
case "$FILE_PATH" in
  "$LOCAL_PREFIX"*) ;;
  *) exit 0 ;;
esac

# Skip noise that shouldn't ship to the server.
case "$FILE_PATH" in
  *"/__pycache__/"*|*.pyc|*"/.venv/"*|*"/.pytest_cache/"*|*"/dataset/"*) exit 0 ;;
esac

# Skip files over 5 MB — code edits are tiny; this guards against accidentally syncing data dumps.
if [ -f "$FILE_PATH" ]; then
  SIZE=$(stat -f%z "$FILE_PATH" 2>/dev/null || stat -c%s "$FILE_PATH" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 5242880 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] skipped (>5MB): $FILE_PATH" >> "$LOG_FILE"
    exit 0
  fi
fi

# Compute path relative to birdss_backend/ — e.g. "app/scripts/bird_rarity.py"
REL_PATH="${FILE_PATH#$LOCAL_PREFIX}"

# Two path formats needed:
#   scp/SFTP wants  /C:/Users/SWARNI~1/eco/birdss_backend/app/scripts/bird_rarity.py
#   PowerShell wants  C:\Users\SWARNI~1\eco\birdss_backend\app\scripts\bird_rarity.py
REMOTE_PATH="$REMOTE_BASE/$REL_PATH"
REL_DIR="$(dirname "$REL_PATH")"
WIN_DIR="C:\\Users\\SWARNI~1\\eco\\birdss_backend\\${REL_DIR//\//\\}"

{
  echo "----"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] change: $REL_PATH"
} >> "$LOG_FILE"

# Ensure parent dir exists on Windows (mkdir -p equivalent) — use Windows-style path for PowerShell.
sshpass -f "$PASS_FILE" ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
  "$REMOTE_HOST" \
  "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force -Path '$WIN_DIR' | Out-Null\"" \
  >> "$LOG_FILE" 2>&1

# Copy the single file.
sshpass -f "$PASS_FILE" scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
  "$FILE_PATH" "$REMOTE_HOST:$REMOTE_PATH" \
  >> "$LOG_FILE" 2>&1

STATUS=$?
if [ $STATUS -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] sync ok" >> "$LOG_FILE"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] sync FAILED (scp exit $STATUS)" >> "$LOG_FILE"
fi

# Always exit 0 so a sync failure never blocks the edit itself.
exit 0
