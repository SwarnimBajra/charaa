"""Runtime inference helpers for Species2Vec.

Designed to be imported from the FastAPI backend. The model is loaded lazily and
cached at module level so the first request pays the load cost and subsequent
requests are essentially free.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
from gensim.models import KeyedVectors

MODELS_DIR = Path(__file__).resolve().parent / "models"
KV_PATH = MODELS_DIR / "species2vec.kv"


@lru_cache(maxsize=1)
def _load() -> KeyedVectors:
    if not KV_PATH.exists():
        raise FileNotFoundError(
            f"Species2Vec model not found at {KV_PATH}. "
            f"Run build_corpus.py then train.py."
        )
    return KeyedVectors.load(str(KV_PATH))


def vocab_size() -> int:
    return len(_load())


def has_species(name: str) -> bool:
    return name in _load()


def similar_species(species_name: str, top_k: int = 10) -> list[dict]:
    """Top-K most similar species to a single query species."""
    kv = _load()
    if species_name not in kv:
        return []
    return [
        {"species": name, "similarity": float(score)}
        for name, score in kv.most_similar(species_name, topn=top_k)
    ]


def expected_species(detected: list[str], top_k: int = 20) -> list[dict]:
    """Given a list of detected species, return the top-K species most likely to co-occur
    with them (i.e. nearest neighbours of the centroid of their embedding vectors)."""
    kv = _load()
    valid = [s for s in detected if s in kv]
    if not valid:
        return []

    centroid = np.mean([kv[s] for s in valid], axis=0)
    # over-fetch so we can drop the already-detected species
    candidates = kv.similar_by_vector(centroid, topn=top_k + len(valid) + 5)
    detected_set = set(detected)
    out: list[dict] = []
    for sp, score in candidates:
        if sp in detected_set:
            continue
        out.append({"species": sp, "similarity": float(score)})
        if len(out) >= top_k:
            break
    return out


def anomaly(
    detected: list[str],
    expected_top_k: int = 20,
    severity_thresholds: tuple[float, float, float, float] = (0.0, 0.3, 0.5, 0.75),
) -> dict:
    """Composite anomaly signal.

    Returns the expected species pool inferred from `detected`, the missing subset,
    a numeric anomaly score in [0, 1] (fraction of expected species not detected),
    and a categorical severity tag.
    """
    expected = expected_species(detected, top_k=expected_top_k)
    expected_names = [e["species"] for e in expected]
    detected_set = set(detected)
    missing = [e for e in expected if e["species"] not in detected_set]

    if not expected_names:
        score = 0.0
    else:
        score = len(missing) / len(expected_names)

    low, mod, high, crit = severity_thresholds
    if score >= crit:
        severity = "critical"
    elif score >= high:
        severity = "high"
    elif score >= mod:
        severity = "moderate"
    elif score > low:
        severity = "low"
    else:
        severity = "none"

    return {
        "detected_count": len(detected),
        "expected_count": len(expected_names),
        "missing_count": len(missing),
        "expected_species": expected,
        "missing_species": missing,
        "anomaly_score": round(score, 3),
        "severity": severity,
    }


if __name__ == "__main__":
    print(f"Species2Vec vocab size: {vocab_size():,}")
    demo = ["Milvus migrans", "Corvus splendens", "Acridotheres tristis"]
    print(f"\nDemo input: {demo}")
    print("\nExpected species:")
    for e in expected_species(demo, top_k=10):
        print(f"  {e['similarity']:.3f}  {e['species']}")
    print(f"\nAnomaly: {anomaly(demo)['severity']}  (score={anomaly(demo)['anomaly_score']})")
