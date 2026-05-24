"""
build_native_data.py
--------------------
Downloads the GRIIS (Global Register of Introduced and Invasive Species) Nepal
checklist and builds native_data.json for use with build_forest_json.py.

Usage:
    uv run scripts/build_native_data.py
    uv run scripts/build_native_data.py --country NP --out native_data.json
    uv run scripts/build_native_data.py --method api     # if IPT fails
    uv run scripts/build_native_data.py --method manual  # fully offline
    uv run scripts/build_native_data.py --iucn-token YOUR_TOKEN

Output (native_data.json):
    {
      "NP": {
        "introduced": ["Acridotheres tristis", ...],
        "invasive":   ["Acridotheres tristis", ...],
        "iucn": { "Lophophorus impejanus": "VU", ... }   <- optional
      }
    }

Logic in build_forest_json.py:
    species in invasive   -> native=False, is_invasive=True
    species in introduced -> native=False
    species in neither    -> native=True  (present in Nepal = assumed native)

Dependencies:  pip install requests

GRIIS Nepal:  https://cloud.gbif.org/griis/resource?r=nepal-griis-gbif
IUCN API:     https://apiv3.iucnredlist.org/api/v3/docs
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import zipfile

try:
    import requests
except ImportError:
    print("[error] requests not installed.  Run: pip install requests")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── URLs ─────────────────────────────────────────────────────────────────────
# The correct DwC-A download URL for GRIIS Nepal is the IPT archive endpoint,
# NOT the GBIF dataset export endpoint (which is for occurrence datasets only).
GRIIS_IPT_URL       = "https://cloud.gbif.org/griis/archive.do?r=nepal-griis-gbif"
GBIF_SPECIES_SEARCH = "https://api.gbif.org/v1/species/search"
GBIF_OCCURRENCE_API = "https://api.gbif.org/v1/occurrence/search"
GRIIS_DATASET_KEY   = "9cfd5f70-968c-4690-94ef-834f01b0cea8"
IUCN_API_BASE       = "https://apiv3.iucnredlist.org/api/v3"

# ── Hard-coded fallback: known GRIIS Nepal birds (offline mode) ───────────────
# Sourced from GRIIS Nepal v2.7 (2020) – birds only subset.
# Use --method manual if both network methods fail.
GRIIS_NP_BIRDS_INTRODUCED = [
    "Acridotheres tristis",   # Common Myna
    "Columba livia",          # Rock Pigeon (feral)
    "Corvus splendens",       # House Crow
    "Passer domesticus",      # House Sparrow
    "Psittacula eupatria",    # Alexandrine Parakeet
    "Psittacula krameri",     # Rose-ringed Parakeet
]
GRIIS_NP_BIRDS_INVASIVE = [
    "Acridotheres tristis",
    "Corvus splendens",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_binomial(name: str) -> str:
    """Return 'Genus species', stripping any authorship."""
    parts = (name or "").strip().split()
    return f"{parts[0]} {parts[1]}" if len(parts) >= 2 else (name or "").strip()


def _get(url: str, params: dict | None = None, timeout: int = 60) -> requests.Response:
    headers = {"User-Agent": "build_native_data/1.1 (forest-health-project)"}
    resp = requests.get(url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp


# ── Method 1: IPT DwC-A archive ───────────────────────────────────────────────

def fetch_via_ipt(country_code: str) -> tuple[list[str], list[str]]:
    """Download DwC-A zip from the GRIIS IPT server and parse taxon + description tables."""
    print(f"[info] Downloading GRIIS Nepal DwC-A from IPT …")
    print(f"[info] {GRIIS_IPT_URL}")
    resp = _get(GRIIS_IPT_URL, timeout=120)
    size_kb = len(resp.content) / 1024
    print(f"[info] Downloaded {size_kb:.1f} KB")
    return _parse_dwca_zip(resp.content)


def _parse_dwca_zip(data: bytes) -> tuple[list[str], list[str]]:
    introduced: list[str] = []
    invasive: list[str] = []
    taxon_id_to_name: dict[str, str] = {}

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        print(f"[info] Archive contents: {names}")

        # ── core taxon table ──────────────────────────────────────────────
        taxon_file = next(
            (n for n in names
             if os.path.basename(n).lower() in ("taxon.txt", "taxa.txt")),
            None,
        )
        if taxon_file:
            with zf.open(taxon_file) as f:
                reader = csv.DictReader(
                    io.TextIOWrapper(f, encoding="utf-8"), delimiter="\t"
                )
                for row in reader:
                    raw = (
                        row.get("species") or
                        row.get("canonicalName") or
                        row.get("scientificName") or ""
                    )
                    name = _to_binomial(raw)
                    if not name:
                        continue
                    tid = row.get("id") or row.get("taxonID") or ""
                    if tid:
                        taxon_id_to_name[tid] = name
                    # Some GRIIS versions embed isInvasive in the core table
                    inv_col = next(
                        (k for k in row if "invasive" in k.lower()), None
                    )
                    if inv_col and row[inv_col].strip().lower() in ("true", "1", "yes"):
                        if name not in invasive:
                            invasive.append(name)
                    if name not in introduced:
                        introduced.append(name)

        # ── description / speciesProfile extension ────────────────────────
        ext_file = next(
            (n for n in names
             if any(kw in n.lower()
                    for kw in ("description", "speciesprofile", "distribution"))
             and n != taxon_file),
            None,
        )
        if ext_file:
            with zf.open(ext_file) as f:
                reader = csv.DictReader(
                    io.TextIOWrapper(f, encoding="utf-8"), delimiter="\t"
                )
                for row in reader:
                    inv_col = next(
                        (k for k in row if "invasive" in k.lower()), None
                    )
                    if not inv_col:
                        continue
                    if row[inv_col].strip().lower() in ("true", "1", "yes"):
                        tid = row.get("id") or row.get("coreid") or ""
                        name = taxon_id_to_name.get(tid, "")
                        if not name:
                            raw = (
                                row.get("species") or
                                row.get("canonicalName") or
                                row.get("scientificName") or ""
                            )
                            name = _to_binomial(raw)
                        if name and name not in invasive:
                            invasive.append(name)

    print(f"[info] Parsed {len(introduced)} introduced, {len(invasive)} invasive")
    return introduced, invasive


# ── Method 2: GBIF Species Search API ─────────────────────────────────────────

def fetch_via_gbif_api(country_code: str) -> tuple[list[str], list[str]]:
    """Page through GBIF species search for the GRIIS dataset key (no zip needed)."""
    print("[info] Fetching via GBIF Species Search API …")
    introduced: list[str] = []
    offset, limit, total = 0, 300, None

    while True:
        resp = _get(GBIF_SPECIES_SEARCH, params={
            "datasetKey": GRIIS_DATASET_KEY,
            "limit": limit,
            "offset": offset,
        })
        data = resp.json()
        if total is None:
            total = data.get("count", 0)
            print(f"[info] {total} records in GRIIS dataset")

        for rec in data.get("results", []):
            name = _to_binomial(
                rec.get("species") or
                rec.get("canonicalName") or
                rec.get("scientificName") or ""
            )
            if name and name not in introduced:
                introduced.append(name)

        offset += limit
        if offset >= (total or 0):
            break
        time.sleep(0.25)

    print(f"[info] Found {len(introduced)} introduced species")

    # Cross-reference invasive via occurrence API
    invasive = _fetch_invasive_occurrences(country_code)
    return introduced, invasive


def _fetch_invasive_occurrences(country_code: str) -> list[str]:
    """Species with establishmentMeans=INVASIVE in GBIF occurrences for country."""
    print("[info] Fetching invasive occurrences from GBIF …")
    invasive: list[str] = []
    offset, limit, total = 0, 300, None

    while True:
        resp = _get(GBIF_OCCURRENCE_API, params={
            "country": country_code,
            "establishmentMeans": "INVASIVE",
            "limit": limit,
            "offset": offset,
        })
        data = resp.json()
        if total is None:
            total = data.get("count", 0)
            print(f"[info] {total} occurrence records flagged INVASIVE")

        for rec in data.get("results", []):
            name = _to_binomial(
                rec.get("species") or rec.get("scientificName") or ""
            )
            if name and name not in invasive:
                invasive.append(name)

        offset += limit
        if offset >= (total or 0) or offset > 3000:
            break
        time.sleep(0.2)

    print(f"[info] {len(invasive)} invasive species from occurrence records")
    return invasive


# ── IUCN Red List API ──────────────────────────────────────────────────────────

def fetch_iucn_categories(species_names: list[str], token: str) -> dict[str, str]:
    """Look up IUCN Red List category (LC, NT, VU, EN, CR …) for each species."""
    print(f"[info] Fetching IUCN categories for {len(species_names)} species …")
    categories: dict[str, str] = {}
    for i, name in enumerate(species_names):
        if i % 20 == 0:
            print(f"  [{i}/{len(species_names)}]")
        try:
            resp = _get(
                f"{IUCN_API_BASE}/species/{name}?token={token}", timeout=15
            )
            result = resp.json().get("result", [])
            if result:
                categories[name] = result[0].get("category", "NE")
        except Exception as e:
            print(f"  [warn] IUCN lookup failed for {name}: {e}")
        time.sleep(0.2)
    print(f"[info] Retrieved {len(categories)} IUCN categories")
    return categories


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Build native_data.json from GRIIS Nepal + optional IUCN."
    )
    p.add_argument("--country", default="NP", help="ISO 2-letter country code")
    p.add_argument("--out", default="native_data.json", help="Output JSON path")
    p.add_argument(
        "--method", choices=["ipt", "api", "manual"], default="ipt",
        help=(
            "ipt    – DwC-A zip from GRIIS IPT server (default)\n"
            "api    – GBIF species search + occurrence APIs\n"
            "manual – hard-coded bird list (fully offline)"
        ),
    )
    p.add_argument(
        "--iucn-token", default=None,
        help="IUCN Red List API token. Free at https://apiv3.iucnredlist.org/api/v3/token",
    )
    p.add_argument(
        "--iucn-species-file", default=None,
        help="Text file: one species name per line to look up in IUCN (optional).",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    country = args.country.upper()
    out_path = args.out
    if not os.path.isabs(out_path):
        out_path = os.path.join(SCRIPT_DIR, out_path)

    # ── Step 1: fetch introduced / invasive ──────────────────────────────────
    introduced: list[str] = []
    invasive: list[str] = []

    if args.method == "manual":
        print("[info] Using hard-coded GRIIS Nepal bird list (offline mode)")
        introduced = list(GRIIS_NP_BIRDS_INTRODUCED)
        invasive   = list(GRIIS_NP_BIRDS_INVASIVE)
    else:
        fetch_fn = fetch_via_ipt if args.method == "ipt" else fetch_via_gbif_api
        try:
            introduced, invasive = fetch_fn(country)
        except Exception as e:
            print(f"[warn] {args.method!r} method failed: {e}")
            # Auto-fallback: ipt -> api -> manual
            if args.method == "ipt":
                print("[info] Retrying with GBIF API fallback …")
                try:
                    introduced, invasive = fetch_via_gbif_api(country)
                except Exception as e2:
                    print(f"[warn] API fallback also failed: {e2}")
            if not introduced:
                print("[info] Using hard-coded bird list as final fallback.")
                introduced = list(GRIIS_NP_BIRDS_INTRODUCED)
                invasive   = list(GRIIS_NP_BIRDS_INVASIVE)

    # ── Step 2: optional IUCN lookup ─────────────────────────────────────────
    iucn: dict[str, str] = {}
    if args.iucn_token:
        lookup_list = introduced
        if args.iucn_species_file and os.path.exists(args.iucn_species_file):
            with open(args.iucn_species_file) as f:
                lookup_list = [ln.strip() for ln in f if ln.strip()]
        iucn = fetch_iucn_categories(lookup_list, args.iucn_token)

    # ── Step 3: write JSON ────────────────────────────────────────────────────
    output: dict = {
        country: {
            "introduced": sorted(introduced),
            "invasive":   sorted(invasive),
        }
    }
    if iucn:
        output[country]["iucn"] = iucn

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\n[ok] Wrote {out_path}")
    print(f"     Introduced : {len(introduced)}")
    print(f"     Invasive   : {len(invasive)}")
    if iucn:
        print(f"     IUCN       : {len(iucn)}")
    print(
        f"\nNext step:\n"
        f"  uv run scripts/build_forest_json.py "
        f"--country NP --native-data {os.path.basename(out_path)}"
    )


if __name__ == "__main__":
    main()