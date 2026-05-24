# MockingBird

Run

```
uv run uvicorn app:app --reload
```

Note: For WEBM/M4A uploads, install ffmpeg so the backend can convert to WAV.

RAG service (in a separate terminal)

```
cd dataset/rag
uv run uvicorn app:app --reload --port 8005
```

Frontend (Vite)

```
cd frontend/aura-forest-sync
$env:VITE_BIRD_API_URL="http://127.0.0.1:8000"
bun install
bun run dev
```

Optional backend env vars

```
RAG_BASE_URL=http://127.0.0.1:8005
FRONTEND_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

Frontend env vars

```
VITE_OPENWEATHER_KEY=your_openweather_key
```

**api testing**

```
http://127.0.0.1:8000/docs
```
