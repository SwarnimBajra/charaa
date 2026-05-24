import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx
from fastapi import UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from app.utils import detect_species, preprocess_species, merge_species, prepare_audio_for_inference
from . import router

logger = logging.getLogger(__name__)

RAG_BASE_URL = os.getenv("RAG_BASE_URL", "http://127.0.0.1:8005")
RAG_QUERY_URL = f"{RAG_BASE_URL}/rag/query"


class DetectedSpecies(BaseModel):
    name: str
    scientificName: str
    confidence: float
    count: int
    description: str | None = None


class ImageIntel(BaseModel):
    density: int
    vegetationHealth: int
    waterPresence: int
    fireRisk: int
    humanDisturbance: int
    overall: int


class AnalyzeResult(BaseModel):
    biodiversityScore: int
    speciesDetected: list[DetectedSpecies]
    totalBirds: int
    healthStatus: str
    trend: str
    forestRangeKm2: int
    forestHealthIndex: int
    acousticComplexity: int
    forestName: str | None = None
    ecoregion: str | None = None
    estimatedTreeCount: int | None = None
    biome: str | None = None
    fhqi: int | None = None
    fhqiStatus: str | None = None
    imageIntel: ImageIntel | None = None


def _parse_optional_json(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _compute_scores(merged: list[dict[str, Any]]) -> tuple[int, int, str]:
    if not merged:
        return 0, 0, "Degraded"

    total = sum(s["count"] for s in merged)
    richness = len(merged)

    # Shannon diversity index normalization
    import math

    shannon = 0.0
    for s in merged:
        proportion = s["count"] / total
        shannon -= proportion * math.log(proportion)

    max_shannon = math.log(richness) if richness > 1 else 1
    diversity_score = int(min(100, round((shannon / max_shannon) * 100)))

    dominance = max(s["count"] for s in merged) / total
    dominance_score = int(min(100, round((1 - dominance) * 100)))

    fhqi = int(min(100, round(diversity_score * 0.7 + dominance_score * 0.3)))

    if fhqi >= 70:
        status = "Healthy"
    elif fhqi >= 45:
        status = "Moderate"
    else:
        status = "Degraded"

    return diversity_score, fhqi, status


async def _query_rag(client: httpx.AsyncClient, query: str) -> str | None:
    try:
        response = await client.post(RAG_QUERY_URL, json={"query": query, "top_k": 3})
        if response.status_code != 200:
            return None
        data = response.json()
        answer = data.get("answer")
        return answer.strip() if isinstance(answer, str) and answer.strip() else None
    except Exception as exc:
        logger.warning("RAG query failed for %s: %s", query, exc)
        return None


async def _enrich_species_with_rag(species: list[dict[str, Any]]) -> dict[str, str]:
    if not species:
        return {}

    semaphore = asyncio.Semaphore(4)

    async with httpx.AsyncClient(timeout=20.0) as client:
        async def task(scientific_name: str) -> tuple[str, str | None]:
            async with semaphore:
                query = f"Provide a concise profile for the bird species {scientific_name}."
                answer = await _query_rag(client, query)
                return scientific_name, answer

        tasks = [task(s["scientific_name"]) for s in species]
        results = await asyncio.gather(*tasks)

    return {name: text for name, text in results if text}


@router.post("/analyze-audio", response_model=AnalyzeResult)
async def analyze_audio(
    audio: UploadFile = File(...),
    lat: float = Form(...),
    lon: float = Form(...),
    climate: str | None = Form(None),
    season: str | None = Form(None),
    forestName: str | None = Form(None),
    biome: str | None = Form(None),
    imageIntel: str | None = Form(None),
):
    audio_data = await audio.read()

    extension = Path(audio.filename).suffix if audio.filename else ".mp3"
    temp_path = None
    cleanup_paths: list[Path] = []

    with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as temp_audio:
        temp_audio.write(audio_data)
        temp_path = temp_audio.name

    try:
        audio_path, cleanup_paths = prepare_audio_for_inference(Path(temp_path))
        raw_data = detect_species(audio_path)
    except ValueError as exc:
        logger.warning("Audio preprocessing failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("BirdNET failed: %s", exc)
        raise HTTPException(status_code=500, detail="BirdNET inference failed")
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                logger.warning("Failed to remove temp file: %s", temp_path)
        for extra in cleanup_paths:
            try:
                extra.unlink(missing_ok=True)
            except Exception:
                logger.warning("Failed to remove temp file: %s", extra)

    filtered = preprocess_species(raw_data, 0.6)
    merged = merge_species(filtered)

    rag_map = await _enrich_species_with_rag(merged)

    species_detected: list[DetectedSpecies] = []
    for s in merged:
        description = rag_map.get(s["scientific_name"])
        species_detected.append(
            DetectedSpecies(
                name=s["common_name"],
                scientificName=s["scientific_name"],
                confidence=s["avg_confidence"],
                count=s["count"],
                description=description,
            )
        )

    biodiversity_score, fhqi, status = _compute_scores(merged)
    total_birds = sum(s["count"] for s in merged)

    image_payload = _parse_optional_json(imageIntel)
    image_intel = ImageIntel(**image_payload) if image_payload else None

    acoustic_complexity = int(min(100, round(35 + biodiversity_score * 0.6)))

    return AnalyzeResult(
        biodiversityScore=biodiversity_score,
        speciesDetected=species_detected,
        totalBirds=total_birds,
        healthStatus=status,
        trend="stable",
        forestRangeKm2=25,
        forestHealthIndex=fhqi,
        acousticComplexity=acoustic_complexity,
        forestName=forestName,
        ecoregion=climate,
        estimatedTreeCount=None,
        biome=biome,
        fhqi=fhqi,
        fhqiStatus=status,
        imageIntel=image_intel,
    )
