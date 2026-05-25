"""FHI ML predictor — loaded once at startup, called per request.

Computes the same 5 features used during training from a live species list,
then returns a predicted Forest Health Index score in [0, 1].

If the model file hasn't been trained yet, predict() returns None so the
/forest endpoint degrades gracefully (heuristic score only).
"""

from __future__ import annotations

import logging
import math
import pickle
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
MODEL_PATH = SCRIPTS_DIR / "fhi_model.pkl"

# Global model artifact — loaded once
_artifact: dict | None = None


def _load_model() -> dict | None:
    global _artifact
    if _artifact is not None:
        return _artifact
    if not MODEL_PATH.exists():
        logger.warning("FHI model not found at %s. Run train_fhi_model.py to enable predictions.", MODEL_PATH)
        return None
    try:
        with open(MODEL_PATH, "rb") as f:
            _artifact = pickle.load(f)
        logger.info("FHI model loaded from %s (features: %s)", MODEL_PATH, _artifact["features"])
        return _artifact
    except Exception as e:
        logger.error("Failed to load FHI model: %s", e)
        return None


def _shannon(counts: list[int]) -> float:
    total = sum(counts)
    if total == 0:
        return 0.0
    h = 0.0
    for c in counts:
        p = c / total
        if p > 0:
            h -= p * math.log(p)
    return h


def _dominance(counts: list[int]) -> float:
    total = sum(counts)
    return max(counts) / total if total else 0.0


def _forest_dep_score(species_data: list[dict], birdfunc_db) -> float:
    """Weighted forest dependency using BirdTraitDB (passed in to avoid circular import)."""
    total = sum(s["count"] for s in species_data)
    if total == 0:
        return 0.4
    score = 0.0
    for s in species_data:
        dep = birdfunc_db.forest_dependency_score(s["scientific_name"])
        score += (s["count"] / total) * (dep if dep is not None else 0.4)
    return score


def _mean_rarity(species_data: list[dict]) -> float:
    """Rarity proxy: 1/log(count+10) per species using detection count as frequency.

    At inference we don't have global GBIF counts, so we use the relative
    detection frequency within the current session. This is a proxy — a species
    detected only once is treated as rarer than one detected ten times.
    """
    if not species_data:
        return 0.2
    vals = [1.0 / math.log(s["count"] + 10) for s in species_data]
    return sum(vals) / len(vals)


def predict(species_data: list[dict], birdfunc_db) -> Optional[float]:
    """Return predicted FHI score in [0, 1], or None if model not available.

    Args:
        species_data: list of {"scientific_name": str, "count": int}
        birdfunc_db: BirdTraitDB instance (passed from route to avoid reload)
    """
    artifact = _load_model()
    if artifact is None or not species_data:
        return None

    try:
        model = artifact["model"]
        feature_names = artifact["features"]

        counts = [s["count"] for s in species_data]
        richness = len(species_data)
        sh = _shannon(counts)
        dom = _dominance(counts)
        fd = _forest_dep_score(species_data, birdfunc_db)
        mr = _mean_rarity(species_data)

        feature_map = {
            "richness": richness,
            "shannon": sh,
            "dominance": dom,
            "forest_dep": fd,
            "mean_rarity": mr,
        }

        X = np.array([[feature_map[f] for f in feature_names]])
        pred = float(np.clip(model.predict(X)[0], 0.0, 1.0))
        return round(pred, 4)

    except Exception as e:
        logger.error("FHI prediction failed: %s", e)
        return None
