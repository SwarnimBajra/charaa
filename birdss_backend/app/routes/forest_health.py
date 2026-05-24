from . import router
from app.utils import preprocess_species, merge_species, Species
from app.scripts.native import calculate_native_score
from app.scripts.forest_dependency import BirdTraitDB
from app.scripts.rarity import RarityScorer

import logging
import math
import asyncio
from pathlib import Path
import json
from pydantic import BaseModel
from geopy.geocoders import Nominatim

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BASE_DIR / "scripts"
FOREST_JSON_PATH = SCRIPTS_DIR / "forest_health_input.json"

# Initialize databases
bird_trait_db = BirdTraitDB(str(SCRIPTS_DIR / "BirdFuncDat.txt"))


def get_lat_lon(loc: str):
    geolocator = Nominatim(user_agent="forest-health-app")
    try:
        location = geolocator.geocode(loc)
        if location:
            return location.latitude, location.longitude
    except Exception as e:
        logger.error(f"Geocoding error: {e}")
    return 27.7172, 85.3240  # Default to Kathmandu


# SPECIES_REACHNESS
#  = Calculates the number of unique species in the forest
def calculate_species(species_data):
    return len(species_data)


# SHANNON DIVERSITY INDEX
#  = 10 equally distributed species is healthier than 95% crows + 1 rare bird
#
# Measures:
#           diversity, balance, ecosys complexity
#
# Formula:
#           H′= − ∑ * p * ln(p)
#          where, p = proportion of species i
#
def calculate_shannon_idx(species_data: list):
    total = sum(s["count"] for s in species_data)

    if total == 0:
        return 0

    shannon = 0

    for specie in species_data:
        proportion = specie["count"] / total

        shannon -= proportion * math.log(proportion)

    return round(shannon, 3)


# DOMINANCE SCORE
#  = Calculates if one species dominates the whole forest
def calculate_dominance(species_data: list):
    total = sum(s["count"] for s in species_data)

    if total == 0:
        return {
            "dominance_score": 0,
            "dominant_species": None,
        }

    dominant = max(species_data, key=lambda s: s["count"])
    dominance_ratio = dominant["count"] / total

    return {
        "dominance_score": round(dominance_ratio, 3),
        "dominant_species": dominant["scientific_name"],
    }


# NORMALIZE
# = normalize richness score, shannon score, dominance_score
async def normalize_score(loc, richness, shannon, dominance):
    #  richness require total unique num of spcies = min(richness / 20, 1)
    #  shannon_score require ln(s) where S = number of spcies

    # 1. FIRST build file
    await start_querying(loc)
    # 2. THEN read file
    total_species = get_total_num_of_species()

    if total_species <= 0:
        print("ERROR: total species is 0")
        total_species = 1

    # Richness: how close to historical baseline
    norm_richness = min(richness / total_species, 1)

    # Shannon: divide by max possible FOR DETECTED species count
    max_shannon = math.log(richness) if richness > 1 else 1
    norm_shannon = min(shannon / max_shannon, 1)

    # Dominance: invert so high = healthy
    norm_dominance = 1 - dominance["dominance_score"]

    return (norm_richness, norm_shannon, norm_dominance)


async def start_querying(loc: str):
    import subprocess

    def run_build():
        return subprocess.run(
            [
                "uv",
                "run",
                str(SCRIPTS_DIR / "build_forest_json.py"),
                "--locality",
                loc,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    result = await asyncio.to_thread(run_build)

    if result.returncode != 0:
        raise Exception(result.stderr)

    if not FOREST_JSON_PATH.exists():
        raise Exception("Forest JSON not created")

    return True


# now read forest_health_input.json file from scripts/
def get_total_num_of_species():
    # Read generated JSON file
    with open(FOREST_JSON_PATH, "r") as f:
        data = json.load(f)

    total_species = data.get("total_species", 0)
    print("==___Total species___==", total_species)

    return total_species


"""
-> Total num of species in that area.
-> All species, with history of count on that particular species on that location
"""


# __ECOLOGICAL METRICAL__


# Native
async def native_ratio(loc: str, species_data):
    if not species_data:
        return 0

    lat, lon = get_lat_lon(loc)

    formatted_data = [
        {"species": s["scientific_name"], "count": s["count"]} for s in species_data
    ]

    try:
        result = await asyncio.to_thread(
            calculate_native_score,
            latitude=lat,
            longitude=lon,
            species_data=formatted_data,
        )
        return result.get("native_score", 0.0)
    except Exception as e:
        logger.error(f"Error calculating native score: {e}")
        return 0.0


# Forest Dependency
def forest_dependency(species_data):
    total = sum(s["count"] for s in species_data)

    if total == 0:
        return {"score": 0, "matched": 0, "total": 0}

    score = 0
    matched_count = 0

    for s in species_data:
        dep = bird_trait_db.forest_dependency_score(s["scientific_name"])
        if dep is None:
            # Species not found in BirdFuncDat — use moderate default
            dep = 0.4
            logger.info(
                "Species %s not found in BirdFuncDat, using default",
                s["scientific_name"],
            )
        else:
            matched_count += 1

        score += (s["count"] / total) * dep

    return {
        "score": round(score, 4),
        "matched": matched_count,
        "total": len(species_data),
    }


# Rarity score — uses RarityScorer (local DB first, IUCN API fallback)
async def rarity_score(species_data):
    total = sum(s["count"] for s in species_data)

    if total == 0:
        return {"score": 0, "matched": 0, "total": 0, "confidence": "none"}

    scorer = RarityScorer()
    try:
        tasks = []
        for s in species_data:
            tasks.append(scorer.get_rarity(s["scientific_name"]))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        score = 0
        matched_count = 0
        details = []
        confidence_scores = []  # Track per-species confidence

        for s, res in zip(species_data, results):
            rarity = None

            if isinstance(res, dict) and res.get("rarity_score") is not None:
                rarity = res["rarity_score"]
                source = res.get("source", "unknown")
                confidence = res.get("confidence", "low")

                if source != "default":
                    matched_count += 1

                confidence_scores.append(confidence)
                details.append(
                    {
                        "species": s["scientific_name"],
                        "category": res.get("category"),
                        "rarity_score": rarity,
                        "source": source,
                        "confidence": confidence,
                    }
                )
            else:
                # All lookups failed — use moderate default
                rarity = 0.2
                error_msg = ""
                if isinstance(res, dict):
                    error_msg = res.get("error", "unknown")
                elif isinstance(res, Exception):
                    error_msg = str(res)
                logger.warning(
                    "Rarity lookup failed for %s (%s), using default 0.2",
                    s["scientific_name"],
                    error_msg,
                )
                confidence_scores.append("low")
                details.append(
                    {
                        "species": s["scientific_name"],
                        "category": None,
                        "rarity_score": rarity,
                        "source": "default",
                        "confidence": "low",
                    }
                )

            score += (s["count"] / total) * rarity

        # Overall confidence: majority vote
        high_count = sum(1 for c in confidence_scores if c == "high")
        overall_confidence = (
            "high"
            if high_count > len(confidence_scores) / 2
            else "medium"
            if high_count > 0
            else "low"
        )

        return {
            "score": round(score, 4),
            "matched": matched_count,
            "total": len(species_data),
            "confidence": overall_confidence,
            "details": details,
        }
    except Exception as e:
        logger.error(f"Error calculating rarity score: {e}")
        return {
            "score": 0.0,
            "matched": 0,
            "total": len(species_data),
            "confidence": "none",
            "error": str(e),
        }
    finally:
        await scorer.close()


class ForestRequest(BaseModel):
    loc: str
    species: list[Species]


@router.post("/forest")
async def forest(req: ForestRequest):
    filtered = preprocess_species(req.species, 0.6)

    merged = merge_species(filtered)

    # species_reachness
    unique_species = calculate_species(merged)

    # shannon_idx
    shannon_idx = calculate_shannon_idx(merged)

    # dominance_score
    dominance = calculate_dominance(merged)

    # normalization
    (norm_unique, norm_shannon, norm_dominance) = await normalize_score(
        req.loc, unique_species, shannon_idx, dominance
    )

    # Ecological metrics (run native + rarity concurrently)
    native_task = native_ratio(req.loc, merged)
    rarity_task = rarity_score(merged)

    forest_dependency_result = forest_dependency(merged)
    native_score_val, rarity_result = await asyncio.gather(native_task, rarity_task)

    logger.info(merged)

    # ---------------------------------------------------
    # COMPOSITE FOREST HEALTH SCORE
    # ---------------------------------------------------
    # Weighted combination of all normalized metrics.
    #
    # Weights reflect ecological importance:
    #   - Shannon diversity (25%): ecosystem complexity/balance
    #   - Species richness (15%): biodiversity count
    #   - Dominance inverse (10%): even distribution
    #   - Native ratio (20%): presence of native species
    #   - Forest dependency (20%): forest-obligate species present
    #   - Rarity (10%): presence of rare/threatened species
    #
    # Higher composite = healthier forest
    # ---------------------------------------------------

    fd_score = forest_dependency_result["score"]
    rarity_val = rarity_result["score"]

    composite_health = (
        0.25 * norm_shannon
        + 0.15 * norm_unique
        + 0.10 * norm_dominance
        + 0.20 * native_score_val
        + 0.20 * fd_score
        + 0.10 * rarity_val
    )
    composite_health = round(min(max(composite_health, 0.0), 1.0), 4)

    # Health classification
    if composite_health >= 0.75:
        health_label = "Excellent"
    elif composite_health >= 0.55:
        health_label = "Good"
    elif composite_health >= 0.35:
        health_label = "Fair"
    elif composite_health >= 0.15:
        health_label = "Poor"
    else:
        health_label = "Critical"

    return {
        "composite_health": {
            "score": composite_health,
            "label": health_label,
            "weights": {
                "shannon_diversity": 0.25,
                "species_richness": 0.15,
                "dominance_balance": 0.10,
                "native_ratio": 0.20,
                "forest_dependency": 0.20,
                "rarity": 0.10,
            },
        },
        "unique_species": unique_species,
        "shannon_idx": shannon_idx,
        "dominance": dominance,
        "norm_unique": norm_unique,
        "norm_shannon": norm_shannon,
        "norm_dominance": norm_dominance,
        "native_ratio": native_score_val,
        "forest_dependency": fd_score,
        "forest_dependency_detail": {
            "matched": forest_dependency_result["matched"],
            "total": forest_dependency_result["total"],
        },
        "rarity_score": rarity_val,
        "rarity_detail": {
            "matched": rarity_result["matched"],
            "total": rarity_result["total"],
            "confidence": rarity_result.get("confidence", "unknown"),
            "species": rarity_result.get("details", []),
        },
    }
