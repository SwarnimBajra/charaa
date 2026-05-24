import httpx
from typing import Dict, Any, Optional, List
import asyncio
from dotenv import load_dotenv
import os
import json
import logging
from pathlib import Path

load_dotenv()

logger = logging.getLogger(__name__)

SCRIPTS_DIR = Path(__file__).resolve().parent
RARITY_JSON_PATH = SCRIPTS_DIR / "species_rarity.json"


class LocalRarityDB:
    """
    Offline rarity lookup from species_rarity.json.

    This is the PRIMARY source — fast, no API calls, no rate limits.
    Built by: uv run app/scripts/build_rarity_data.py --iucn-token TOKEN
    """

    def __init__(self, json_path: Path = RARITY_JSON_PATH):
        self._data: Dict[str, Dict] = {}
        self._loaded = False
        self._path = json_path
        self._load()

    def _load(self):
        if not self._path.exists():
            logger.warning("species_rarity.json not found at %s — local lookup disabled", self._path)
            return

        try:
            with open(self._path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            self._data = raw.get("species", {})
            meta = raw.get("meta", {})
            self._loaded = True
            logger.info(
                "Loaded local rarity DB: %d species (IUCN matched: %s)",
                meta.get("species_count", len(self._data)),
                meta.get("iucn_matched", "?"),
            )
        except Exception as e:
            logger.error("Failed to load species_rarity.json: %s", e)

    def lookup(self, scientific_name: str) -> Optional[Dict[str, Any]]:
        """
        Look up rarity for a species.

        Returns:
            {"category": "LC", "score": 0.1} or None if not found
        """
        if not self._loaded:
            return None

        entry = self._data.get(scientific_name.strip())
        if entry:
            return entry

        # Try case-insensitive match
        key_lower = scientific_name.strip().lower()
        for name, data in self._data.items():
            if name.lower() == key_lower:
                return data

        return None

    @property
    def available(self) -> bool:
        return self._loaded and len(self._data) > 0


class IUCNClient:
    """
    IUCN Red List API v3 client for species rarity scores.

    Uses token-based auth via query parameter (v3 style).
    Endpoint: https://apiv3.iucnredlist.org/api/v3/species/{name}?token=KEY

    This is the FALLBACK source — used only when local DB doesn't have the species.
    """

    BASE_URL = "https://apiv3.iucnredlist.org/api/v3"

    RARITY_MAP = {
        "LC": 0.1,   # Least Concern
        "NT": 0.3,   # Near Threatened
        "VU": 0.5,   # Vulnerable
        "EN": 0.75,  # Endangered
        "CR": 0.95,  # Critically Endangered
        "EW": 0.95,  # Extinct in the Wild
        "EX": 1.0,   # Extinct
        "DD": 0.3,   # Data Deficient — uncertain, treat as moderate
        "NE": 0.2,   # Not Evaluated — treat as unknown/moderate-low
    }

    def __init__(self):
        self.api_key = os.getenv("IUCN_API", "")
        self.client = httpx.AsyncClient(
            headers={
                "Accept": "application/json",
            },
            timeout=30.0,
        )
        # In-memory cache for API responses (persists for client lifetime)
        self._cache: Dict[str, Dict[str, Any]] = {}

    # -----------------------------
    # 1. Get species info (v3)
    # -----------------------------
    async def get_species(self, scientific_name: str) -> Dict[str, Any]:
        """
        Fetch species data from IUCN v3 API.

        v3 uses token as query param, NOT Authorization header.
        Endpoint: /species/{name}?token=KEY
        Response: {"result": [{"category": "LC", ...}]}
        """
        url = f"{self.BASE_URL}/species/{scientific_name}"
        params = {"token": self.api_key}

        resp = await self.client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    # -----------------------------
    # 2. Get species rarity
    # -----------------------------
    async def get_species_rarity(self, scientific_name: str) -> Dict[str, Any]:
        """
        Get rarity score for a species.

        Checks cache first, then hits the IUCN API.

        Returns:
            {
                "species": str,
                "category": "LC" | "NT" | "VU" | ...,
                "rarity_score": float (0.0 - 1.0),
                "source": "iucn_api"
            }
        """
        # Check cache first
        if scientific_name in self._cache:
            return self._cache[scientific_name]

        try:
            data = await self.get_species(scientific_name)
        except httpx.HTTPStatusError as e:
            logger.warning(
                "IUCN API error for %s: %s", scientific_name, e.response.status_code
            )
            result = {
                "species": scientific_name,
                "category": None,
                "rarity_score": None,
                "error": f"HTTP {e.response.status_code}",
            }
            return result
        except Exception as e:
            logger.warning("IUCN API request failed for %s: %s", scientific_name, e)
            result = {
                "species": scientific_name,
                "category": None,
                "rarity_score": None,
                "error": str(e),
            }
            return result

        # v3 response structure: {"result": [{"category": "LC", ...}]}
        results = data.get("result", [])

        if not results:
            result = {
                "species": scientific_name,
                "category": None,
                "rarity_score": None,
                "error": "Species not found in IUCN",
            }
            return result

        # First result is the species assessment
        species_data = results[0]
        category = species_data.get("category")
        rarity_score = self.RARITY_MAP.get(category)

        result = {
            "species": scientific_name,
            "category": category,
            "rarity_score": rarity_score,
            "source": "iucn_api",
        }

        # Cache successful results
        if rarity_score is not None:
            self._cache[scientific_name] = result

        return result

    # -----------------------------
    # 3. Close client
    # -----------------------------
    async def close(self):
        await self.client.aclose()


class RarityScorer:
    """
    Unified rarity scorer — local DB first, IUCN API fallback.

    Usage:
        scorer = RarityScorer()
        result = await scorer.get_rarity("Gyps bengalensis")
        # {"species": "Gyps bengalensis", "category": "CR", "rarity_score": 0.95, "source": "local_db"}

        await scorer.close()
    """

    RARITY_MAP = IUCNClient.RARITY_MAP

    def __init__(self):
        self.local_db = LocalRarityDB()
        self.iucn_client = IUCNClient()

    async def get_rarity(self, scientific_name: str) -> Dict[str, Any]:
        """
        Get rarity score — tries local DB first, then IUCN API.

        Returns:
            {
                "species": str,
                "category": str | None,
                "rarity_score": float | None,
                "source": "local_db" | "iucn_api" | "default",
                "confidence": "high" | "medium" | "low"
            }
        """
        # 1. Try local database first (instant, reliable)
        local = self.local_db.lookup(scientific_name)
        if local and local.get("category") and local["category"] != "NE":
            return {
                "species": scientific_name,
                "category": local["category"],
                "rarity_score": local["score"],
                "source": "local_db",
                "confidence": "high",
            }

        # 2. Try IUCN API (slower, may fail)
        if self.iucn_client.api_key:
            api_result = await self.iucn_client.get_species_rarity(scientific_name)
            if api_result.get("rarity_score") is not None:
                api_result["source"] = "iucn_api"
                api_result["confidence"] = "high"
                return api_result

        # 3. Use local NE entry if available
        if local:
            return {
                "species": scientific_name,
                "category": local["category"],
                "rarity_score": local["score"],
                "source": "local_db",
                "confidence": "low",
            }

        # 4. Default fallback
        return {
            "species": scientific_name,
            "category": None,
            "rarity_score": 0.2,
            "source": "default",
            "confidence": "low",
        }

    async def close(self):
        await self.iucn_client.close()


async def main():
    scorer = RarityScorer()
    test_species = [
        "Columba livia",
        "Passer domesticus",
        "Lophophorus impejanus",
        "Gyps bengalensis",  # CR - Critically Endangered
    ]
    for species in test_species:
        rarity = await scorer.get_rarity(species)
        print(f"{species}: {rarity}")
    await scorer.close()


if __name__ == "__main__":
    asyncio.run(main())
