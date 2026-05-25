# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project

FastAPI bird-ID backend (`birdss_backend/`) plus a Vite frontend. This Mac **cannot run the backend locally** — code is edited here and executed on a Windows machine over SSH.

## Remote backend (Windows host)

| | |
|---|---|
| SSH alias | `winbackend` (configured in `~/.ssh/config`) |
| Host | `192.168.76.104` |
| User | `swarnim bajracharya` |
| Auth | **Password auth via sshpass** (key auth fought us for hours; password works) |
| Password file | `~/.ssh/winbackend-pass` (chmod 600, outside the repo) |
| Remote repo path | `C:\Users\Swarnim Bajracharya\eco\birdss_backend` |
| Path format for scp/SFTP | `/C:/Users/SWARNI~1/eco/birdss_backend` (capital C+colon; 8.3 short name for the space) |
| Path format for PowerShell | `C:\Users\SWARNI~1\eco\birdss_backend` (backslashes; 8.3 short name) |
| Start command | `uv run uvicorn app:app --reload --host 0.0.0.0 --port 8000` |
| API URL | http://192.168.76.104:8000 (Swagger at `/docs`) |

**SSH into the box:** `sshpass -f ~/.ssh/winbackend-pass ssh winbackend`

**Run a remote command:** `sshpass -f ~/.ssh/winbackend-pass ssh winbackend "powershell -NoProfile -Command '...'"`

## Auto-sync workflow

Every `Edit`, `Write`, or `MultiEdit` inside `birdss_backend/` triggers `.claude/sync-backend.sh`, which uses `scp` (via `sshpass`) to copy the changed file to the Windows host. Uvicorn runs there with `--reload`, so it picks up the change automatically — **no manual restart needed**.

```
edit file on Mac  →  PostToolUse hook  →  scp to Windows  →  uvicorn --reload restarts
```

The hook is in `.claude/settings.json` (matcher: `Edit|Write|MultiEdit`). Edits outside `birdss_backend/` are no-ops. The script also skips `__pycache__/`, `*.pyc`, `.venv/`, `.pytest_cache/`, `dataset/`, and any file >5MB.

**Important:** The PostToolUse hook only takes effect after Claude Code is restarted. If you add/change the hook in a running session, restart Claude Code.

### Manual sync (when the hook isn't loaded, or to force a sync)

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"/Users/dikshitbhatta/Desktop/eco/birdss_backend/PATH/TO/FILE"}}' \
  | /Users/dikshitbhatta/Desktop/eco/.claude/sync-backend.sh
```

### Bulk re-transfer (initial setup or large reorg)

```bash
cd /Users/dikshitbhatta/Desktop/eco/birdss_backend && \
tar -cf - \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' \
  --exclude='.pytest_cache' --exclude='dataset' \
  --exclude='0009156-260519110011954.csv' \
  . | \
sshpass -f ~/.ssh/winbackend-pass ssh winbackend \
  "powershell -NoProfile -Command \"cd 'C:\\Users\\Swarnim Bajracharya\\eco\\birdss_backend'; tar -xf -\""
```

### Watching sync activity

```bash
tail -f .claude/sync.log
```

### Restarting the backend on Windows (if uvicorn dies)

```bash
# Stop any stray uvicorn/python processes:
sshpass -f ~/.ssh/winbackend-pass ssh winbackend "powershell -NoProfile -Command \"Get-Process uvicorn,python -ErrorAction SilentlyContinue | Stop-Process -Force\""

# Start it again, detached (survives SSH session close):
sshpass -f ~/.ssh/winbackend-pass ssh winbackend "powershell -NoProfile -Command \"\$work='C:\\Users\\Swarnim Bajracharya\\eco\\birdss_backend'; Start-Process -FilePath 'uv' -ArgumentList 'run','uvicorn','app:app','--reload','--host','0.0.0.0','--port','8000' -WorkingDirectory \$work -WindowStyle Hidden -RedirectStandardOutput (Join-Path \$work 'uvicorn.out') -RedirectStandardError (Join-Path \$work 'uvicorn.err')\""

# Verify:
curl http://192.168.76.104:8000/docs
```

### Checking what's happening on the backend

```bash
# Read uvicorn output (info logs, errors):
sshpass -f ~/.ssh/winbackend-pass ssh winbackend "powershell -NoProfile -Command \"Get-Content 'C:\\Users\\Swarnim Bajracharya\\eco\\birdss_backend\\uvicorn.err' -Tail 30\""
```

## Critical rules for Claude

- **Never commit the password file.** `~/.ssh/winbackend-pass` lives in `~/.ssh/`, *not* in the repo. Keep it that way. The repo has it gitignored anyway.
- **Don't run the backend on this Mac.** `uv run uvicorn ...` here will fail (hardware). Always run remotely via SSH.
- **Use the 8.3 short name (`SWARNI~1`) in remote paths**, not `Swarnim Bajracharya` with a literal space — `scp` over cmd.exe truncates paths at spaces.
- **scp/SFTP path format is `/C:/Users/...`** (capital C, colon, forward slashes). NOT `/c/Users/...` — that gets treated as a literal directory and writes to `/C:/c/Users/...`.
- **PowerShell path format is `C:\Users\...`** with backslashes. The two formats are not interchangeable.
- **`dataset/` and the 774MB CSV `0009156-260519110011954.csv` are excluded from sync** — never override this.
- **If sync starts failing repeatedly**, check `.claude/sync.log` and verify `sshpass -f ~/.ssh/winbackend-pass ssh winbackend echo ok` works.

## Backend canonical commands

From `birdss_backend/`:
```bash
uv run uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required so the Mac can reach it across the LAN.

Optional RAG service (separate terminal, port 8005):
```bash
cd dataset/rag && uv run uvicorn app:app --reload --port 8005
```

## Frontend

Lives in `frontend/aura-forest-sync/` (Vite). **Not synced automatically.** To point it at the remote backend:
```
VITE_BIRD_API_URL=http://192.168.76.104:8000
```

## What's installed on the Windows machine

| Tool | Status |
|---|---|
| OpenSSH Server | ✅ Running on port 22 |
| Python 3.11 | ✅ `C:\Users\Swarnim Bajracharya\AppData\Local\Programs\Python\Python311\` |
| uv | ✅ Same Scripts folder |
| Git | ✅ `C:\Program Files\Git\` |
| winget | ✅ Available |
| rsync | ❌ Not installed (we use scp instead — works without extra packages) |
