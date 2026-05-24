"""
Native Species Score Calculator
--------------------------------

INPUT:
- latitude
- longitude
- detected bird species list

OUTPUT:
- native score (0.0 -> 1.0)
- detailed species analysis

WHAT THIS DOES:
1. Uses GBIF to check if species occurs near the location
2. Uses IUCN to check native / introduced range
3. Calculates weighted native biodiversity score

---------------------------------------------------
INSTALL
---------------------------------------------------

pip install requests geopy

---------------------------------------------------
ENV
---------------------------------------------------

export IUCN_API_KEY="YOUR_IUCN_API_KEY"

---------------------------------------------------
EXAMPLE
---------------------------------------------------

species_data = [
    {"species": "Passer domesticus", "count": 12},
    {"species": "Pycnonotus jocosus", "count": 4},
    {"species": "Psittacula eupatria", "count": 2},
]

score = calculate_native_score(
    latitude=27.7172,
    longitude=85.3240,
    species_data=species_data
)

print(score)

"""

import os
import math
import time
import logging
import requests
from typing import List, Dict, Optional, Tuple
from geopy.distance import geodesic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# =========================================================
# TTL CACHE
# =========================================================

_CACHE_TTL = 3600  # 1 hour


class TTLCache:
    """Simple TTL-based in-memory cache for API responses."""

    def __init__(self, ttl: int = _CACHE_TTL):
        self._store: Dict[str, Tuple[float, any]] = {}
        self._ttl = ttl

    def get(self, key: str):
        if key in self._store:
            ts, val = self._store[key]
            if time.time() - ts < self._ttl:
                return val
            del self._store[key]
        return None

    def set(self, key: str, value):
        self._store[key] = (time.time(), value)


_gbif_cache = TTLCache()
_iucn_cache = TTLCache()


# =========================================================
# CONFIG
# =========================================================

IUCN_API_KEY = os.getenv("IUCN_API")

GBIF_OCCURRENCE_API = "https://api.gbif.org/v1/occurrence/search"
IUCN_SPECIES_API = "https://apiv3.iucnredlist.org/api/v3/species/countries/name/"
IUCN_COUNTRY_API = "https://apiv3.iucnredlist.org/api/v3/country/getspecies/"


# =========================================================
# HELPER
# =========================================================


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(value, maximum))


# =========================================================
# GET COUNTRY FROM LAT LNG
# =========================================================


# Simple cache for country code lookups
_country_cache = {}


def reverse_geocode_country(latitude, longitude):
    """
    Uses OpenStreetMap Nominatim API.
    Results are cached to avoid hitting rate limits.
    """

    # Round to 2 decimal places for cache key (~1km precision)
    cache_key = (round(latitude, 2), round(longitude, 2))
    if cache_key in _country_cache:
        return _country_cache[cache_key]

    url = (
        f"https://nominatim.openstreetmap.org/reverse"
        f"?format=json"
        f"&lat={latitude}"
        f"&lon={longitude}"
    )

    headers = {"User-Agent": "forest-health-system"}

    # Nominatim requires max 1 request/second
    time.sleep(1)

    try:
        response = requests.get(url, headers=headers, timeout=10)
    except requests.RequestException as e:
        logger.warning("Nominatim request failed: %s", e)
        return None

    if response.status_code != 200:
        return None

    data = response.json()

    address = data.get("address", {})

    country_code = address.get("country_code")

    if not country_code:
        return None

    result = country_code.upper()
    _country_cache[cache_key] = result
    return result


# =========================================================
# GBIF OCCURRENCE CHECK
# =========================================================


def gbif_species_nearby(
    species_name: str, latitude: float, longitude: float, radius_km: float = 50
):
    """
    Check if species has occurrences near location.

    Uses GBIF geo-bounding-box filter to search within ±0.5 degrees
    (~55km) of the target location, then refines by exact distance.

    Results are cached for 1 hour to avoid redundant API calls.

    Returns:
    {
        "found": bool,
        "count": int,
        "distance_km": float
    }
    """

    # Check cache (key includes species + rounded location)
    cache_key = f"gbif:{species_name}:{round(latitude,2)}:{round(longitude,2)}:{radius_km}"
    cached = _gbif_cache.get(cache_key)
    if cached is not None:
        return cached

    # Convert radius_km to approximate degree offset (1 degree ≈ 111km)
    degree_offset = max(radius_km / 111.0, 0.5)

    params = {
        "scientificName": species_name,
        "hasCoordinate": "true",
        "decimalLatitude": f"{latitude - degree_offset},{latitude + degree_offset}",
        "decimalLongitude": f"{longitude - degree_offset},{longitude + degree_offset}",
        "limit": 50,
    }

    try:
        response = requests.get(GBIF_OCCURRENCE_API, params=params, timeout=15)
    except requests.RequestException as e:
        logger.warning("GBIF request failed for %s: %s", species_name, e)
        return {"found": False, "count": 0, "distance_km": None}

    if response.status_code != 200:
        return {"found": False, "count": 0, "distance_km": None}

    data = response.json()

    results = data.get("results", [])

    nearby_count = 0
    nearest_distance = None

    for item in results:
        lat = item.get("decimalLatitude")
        lng = item.get("decimalLongitude")

        if lat is None or lng is None:
            continue

        distance = geodesic((latitude, longitude), (lat, lng)).km

        if distance <= radius_km:
            nearby_count += 1

            if nearest_distance is None:
                nearest_distance = distance
            else:
                nearest_distance = min(nearest_distance, distance)

    result = {
        "found": nearby_count > 0,
        "count": nearby_count,
        "distance_km": nearest_distance,
    }

    _gbif_cache.set(cache_key, result)
    return result


# =========================================================
# IUCN NATIVE CHECK
# =========================================================


def iucn_species_native_to_country(species_name: str, country_code: str):
    """
    Uses IUCN API to determine if species is native.

    Results are cached for 1 hour to avoid redundant API calls.

    Returns:
    {
        "native": bool,
        "presence": str
    }
    """

    # Check cache first
    cache_key = f"iucn_native:{species_name}:{country_code}"
    cached = _iucn_cache.get(cache_key)
    if cached is not None:
        return cached

    if not IUCN_API_KEY:
        raise Exception("Missing IUCN_API_KEY")

    url = IUCN_SPECIES_API + species_name + f"?token={IUCN_API_KEY}"

    try:
        response = requests.get(url, timeout=15)
    except requests.RequestException as e:
        logger.warning("IUCN request failed for %s: %s", species_name, e)
        return {"native": False, "presence": "unknown"}

    if response.status_code != 200:
        return {"native": False, "presence": "unknown"}

    data = response.json()

    results = data.get("result", [])

    for item in results:
        code = item.get("code")

        if code != country_code:
            continue

        origin = str(item.get("origin", "")).lower()

        # Native / reintroduced accepted
        if "native" in origin or "reintroduced" in origin:
            result = {"native": True, "presence": origin}
            _iucn_cache.set(cache_key, result)
            return result

    result = {"native": False, "presence": "introduced_or_unknown"}
    _iucn_cache.set(cache_key, result)
    return result


# =========================================================
# SPECIES NATIVE SCORE
# =========================================================


def calculate_species_native_score(
    species_name: str, count: int, latitude: float, longitude: float, country_code: str
):
    """
    Species scoring logic.

    MAX = 1.0
    """

    # -----------------------------------
    # IUCN native validation
    # -----------------------------------

    iucn_result = iucn_species_native_to_country(species_name, country_code)

    is_native = iucn_result["native"]

    # -----------------------------------
    # GBIF locality validation
    # -----------------------------------

    gbif_result = gbif_species_nearby(species_name, latitude, longitude)

    nearby = gbif_result["found"]

    # -----------------------------------
    # SCORING
    # -----------------------------------

    score = 0.0

    # Native species
    if is_native:
        score += 0.7

    # Locally observed nearby
    if nearby:
        score += 0.3

    # abundance weighting
    abundance_weight = math.log(count + 1)

    final_score = score * abundance_weight

    return {
        "species": species_name,
        "count": count,
        "native": is_native,
        "nearby_occurrence": nearby,
        "score": round(final_score, 4),
    }


# =========================================================
# FINAL NATIVE SCORE
# =========================================================


def calculate_native_score(latitude: float, longitude: float, species_data: List[Dict]):
    """
    species_data example:

    [
        {"species": "Passer domesticus", "count": 12},
        {"species": "Psittacula eupatria", "count": 2},
    ]
    """

    # -----------------------------------
    # Country lookup
    # -----------------------------------

    country_code = reverse_geocode_country(latitude, longitude)

    if not country_code:
        raise Exception("Could not determine country")

    detailed_results = []

    total_score = 0.0
    max_possible = 0.0

    for item in species_data:
        species_name = item["species"]
        count = item.get("count", 1)

        result = calculate_species_native_score(
            species_name=species_name,
            count=count,
            latitude=latitude,
            longitude=longitude,
            country_code=country_code,
        )

        detailed_results.append(result)

        species_weight = math.log(count + 1)

        total_score += result["score"]
        max_possible += species_weight

    # Normalize 0 -> 1
    normalized_score = total_score / max_possible if max_possible > 0 else 0

    normalized_score = clamp(normalized_score)

    return {
        "location": {
            "latitude": latitude,
            "longitude": longitude,
            "country": country_code,
        },
        "native_score": round(normalized_score, 4),
        "species_analysis": detailed_results,
    }


# =========================================================
# TEST
# =========================================================

if __name__ == "__main__":
    species_data = [
        {"species": "Passer domesticus", "count": 12},
        {"species": "Pycnonotus jocosus", "count": 4},
        {"species": "Psittacula eupatria", "count": 2},
    ]

    result = calculate_native_score(
        latitude=27.7172, longitude=85.3240, species_data=species_data
    )

    from pprint import pprint

    pprint(result)
