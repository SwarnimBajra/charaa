# Eco — Forest Biodiversity & Health Intelligence

AI-powered forest health analysis from bird audio. Upload a field recording, and the system identifies bird species, scores ecosystem health from acoustic biodiversity + ecological metadata, and renders a procedural 3D scene of the forest you're standing in.

```
audio (mp3/wav/webm/m4a) ──▶ BirdNET ──▶ species list
                                          │
                                          ├──▶ Shannon / dominance / richness ─┐
                                          ├──▶ native ratio (GBIF)             ├──▶ Composite Forest Health
                                          ├──▶ forest dependency (EltonTraits) │   (weighted score + label)
                                          ├──▶ rarity (local IUCN + fallback)  ┘
                                          ├──▶ FHI predictor model (current-window trained)
                                          ├──▶ RAG (per-species profile)
                                          └──▶ Species2Vec (expected vs. missing → anomaly)
```

## Repo layout

| Path | What it is |
|---|---|
| [birdss_backend/](birdss_backend/) | FastAPI service. BirdNET inference, ecological metrics, RAG. Runs on a Windows host. |
| [birdss_backend/app/](birdss_backend/app/) | FastAPI app: routes, audio utils, scoring scripts. |
| [birdss_backend/species2vec/](birdss_backend/species2vec/) | Word2Vec model trained on GBIF Aves occurrences. Predicts expected co-occurring species and flags anomalies. |
| [birdss_backend/dataset/rag/](birdss_backend/dataset/rag/) | Standalone RAG microservice (port 8005). Returns per-species profiles. |
| [Birdss/](Birdss/) | TanStack Start + Vite frontend (React 19, Three.js, Tailwind, shadcn/ui). |
| [presentation.tex](presentation.tex) | LaTeX presentation slides. |
| [CLAUDE.md](CLAUDE.md) | Operational notes for Claude Code (remote-sync setup, ssh aliases). |

## Architecture

This Mac edits code; the backend runs on a Windows host across the LAN (the model stack needs hardware this machine doesn't have). Edits inside [birdss_backend/](birdss_backend/) auto-sync to the Windows host over SSH; uvicorn's `--reload` picks them up. See [CLAUDE.md](CLAUDE.md) for the full remote-sync recipe.

```
Mac (dev)                       Windows (runtime)
─────────                       ────────────────
edit file ── PostToolUse hook ─▶ scp ─▶ uvicorn --reload
                                          │
Vite dev server ◀──── HTTP ──── FastAPI :8000
                                          │
                                RAG service :8005
```

### Backend (FastAPI)

**Routes** ([birdss_backend/app/routes/](birdss_backend/app/routes/)):

| Endpoint | Purpose |
|---|---|
| `POST /analyze-audio` | Full pipeline. Audio + location → species list + biodiversity score + FHQI + RAG-enriched descriptions. |
| `POST /species` | Audio only → raw BirdNET species list. |
| `POST /forest` | Species list + location → composite forest health (Shannon, dominance, native, forest dependency, rarity). |
| `GET /` | Health check. |

**Composite forest-health weights** ([app/routes/forest_health.py:370](birdss_backend/app/routes/forest_health.py#L370)):

| Metric | Weight | Source |
|---|---|---|
| Shannon diversity | 25% | computed from detected counts |
| Native ratio | 20% | GBIF bbox query at lat/lon |
| Forest dependency | 20% | EltonTraits ([BirdFuncDat.txt](birdss_backend/app/scripts/BirdFuncDat.txt)) |
| Species richness | 15% | unique species / historical baseline for the locality |
| Dominance balance | 10% | 1 − dominant proportion |
| Rarity | 10% | local IUCN table → API fallback |

Composite is clipped to [0, 1] and bucketed into Excellent / Good / Fair / Poor / Critical.

### Current FHI Prediction (AI Model, Minimal Pipeline Change)

Goal: keep the existing API/UI flow, but add a learned predictor that estimates *current* forest health from the same detected species list.

Drop-in shape:

```text
Today:  species_list -> compute_fhqi(species_list)         # heuristic formula
Now:    species_list -> predict_fhi(species_list)          # trained regressor
```

Practical integration pattern:

- Keep the current heuristic score for transparency.
- Add one ML score field in `/forest` response (for example: `predicted_fhi`).
- Return both during rollout:
  - `heuristic_fhi`: current weighted formula
  - `predicted_fhi`: model output in `[0, 1]`

Why this helps the "old data vs current audio" mismatch:

- The historical GBIF baseline can lag reality.
- The model can be trained from a *recent window* (for example 2020+) so it learns current ecological patterns from newer observations.
- This is still minimal-disruption because input and endpoint contract stay almost unchanged.

Recommended model/data setup in this repo:

- Training source: `app/scripts/0009156-260519110011954.csv` (GBIF dump), filtered to recent years.
- Features from species composition:
  - richness
  - Shannon diversity
  - dominance
  - forest dependency
  - rarity proxy
- Regressor: `GradientBoostingRegressor` (scikit-learn), output clipped to `[0,1]`.
- Deployment: save `fhi_model.pkl`, lazy-load in backend utility, infer inside `/forest`.

Important limitation:

- If the training label is only the old heuristic, the model mostly learns to mimic that heuristic.
- To claim true "current FHI prediction," labels should be updated periodically and/or tied to an external current proxy (for example satellite vegetation/forest condition indices).

### Species2Vec ([birdss_backend/species2vec/](birdss_backend/species2vec/))

Skip-gram Word2Vec trained on the GBIF occurrence dump. Each "sentence" is the set of bird species observed in one 0.25° lat/lon cell in one season. Species that co-occur across many such cells end up near each other in vector space.

```bash
cd birdss_backend/species2vec
uv run build_corpus.py      # GBIF CSV → corpus.pkl
uv run train.py             # corpus.pkl → species2vec.kv
uv run evaluate.py          # nearest-neighbours sanity check + t-SNE plot
```

At inference time ([inference.py](birdss_backend/species2vec/inference.py)) the model answers two questions: given the species you *did* detect, which species would you *expect* to co-occur with them, and which expected species are missing? The "missing fraction" becomes a numeric anomaly score and severity tag.

### Frontend (TanStack Start)

[Birdss/src/](Birdss/src/) is a React 19 / TanStack Start / Vite app:

- [src/routes/index.tsx](Birdss/src/routes/index.tsx) — main analysis page (audio upload → results → 3D scene).
- [src/lib/birdApi.ts](Birdss/src/lib/birdApi.ts) — wraps `POST /analyze-audio`. Falls back to a mock when `VITE_BIRD_API_URL` is unset.
- [src/lib/forestApi.ts](Birdss/src/lib/forestApi.ts), [src/lib/ragApi.ts](Birdss/src/lib/ragApi.ts), [src/lib/fireApi.ts](Birdss/src/lib/fireApi.ts) — backend + external service adapters.
- [src/components/ForestScene3D.tsx](Birdss/src/components/ForestScene3D.tsx) — `react-three-fiber` procedural forest driven by [scenePlanner.ts](Birdss/src/lib/scenePlanner.ts).

## Running locally

### Backend (on the Windows host)

```bash
cd birdss_backend
uv run uvicorn app:app --reload --reload-dir app --host 0.0.0.0 --port 8000
```

> `--reload-dir app` is required on Windows. Without it, watchfiles also watches `.venv/` and `dataset/`, and any background activity there interrupts BirdNET's multiprocessing children mid-inference and `/analyze-audio` returns 500.

For WEBM/M4A uploads, `ffmpeg` must be on PATH so the backend can convert to WAV.

Optional RAG service (separate terminal):

```bash
cd birdss_backend/dataset/rag
uv run uvicorn app:app --reload --port 8005
```

API docs: <http://192.168.76.104:8000/docs>

### Frontend

```bash
cd Birdss
bun install
bun run dev
```

`.env` (or shell):

```
VITE_BIRD_API_URL=http://192.168.76.104:8000
VITE_OPENWEATHER_KEY=your_openweather_key
```

### Backend env vars (optional)

```
RAG_BASE_URL=http://127.0.0.1:8005
FRONTEND_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

## Tests

```bash
cd birdss_backend
uv run pytest
```

## Data files

`birdss_backend/app/scripts/0009156-260519110011954.csv` (774 MB GBIF occurrence dump) and `birdss_backend/dataset/` are excluded from the auto-sync hook and from git. The species2vec corpus is built from this CSV; download via [scripts/download_dataset.py](birdss_backend/app/scripts/download_dataset.py) if you don't have it.

## Tech stack

**Backend:** Python 3.13, FastAPI, BirdNET, gensim (Word2Vec), pandas, httpx, geopy, uv.
**Frontend:** React 19, TanStack Start/Router, Vite, Tailwind 4, shadcn/ui, react-three-fiber, recharts.
**External:** GBIF (occurrence + bbox queries), IUCN Red List (with offline fallback), OpenWeather, NASA FIRMS (active fires), Wikipedia (thumbnails).
