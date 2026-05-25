"""
Deterministic structured-facts generator for RAG chunks.

Builds an explicit, keyword-rich "Quick Forest Facts" block from
EltonTraits (BirdFuncDat.txt) foraging-stratum and diet data, plus
optional AVONET fields. The block is appended to each species'
LLM-synthesized narrative before chunking so that forest-type queries
(e.g. "canopy specialist", "understory forager", "frugivore") retrieve
the right species directly instead of relying on the LLM to include
those exact terms.

No external LLM call. Numbers come straight from the source data, so
they stay reliable for downstream scoring even though the RAG narrative
is now richer.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class BirdFuncDatLookup:
    """Index BirdFuncDat.txt by lowercased scientific name."""

    def __init__(self, path: str | Path):
        self.species: dict[str, dict[str, str]] = {}
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                key = (row.get("Scientific") or "").strip().lower()
                if key:
                    self.species[key] = row

    def get(self, scientific_name: str) -> dict[str, str] | None:
        return self.species.get((scientific_name or "").strip().lower())


# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------

# AVONET Habitat.Density codes
_HABITAT_DENSITY_TEXT = {
    1: "dense forest interior (closed canopy)",
    2: "semi-open mosaic (forest edge, scrubland, partial canopy)",
    3: "open habitat (grassland, agricultural land, sparse trees)",
}

# AVONET Migration codes
_MIGRATION_TEXT = {
    1: "sedentary, year-round resident",
    2: "partial migrant",
    3: "full long-distance migrant",
}

# EltonTraits Diet-5Cat → readable label + forest-association tag
_DIET5_TEXT = {
    "PlantSeed": ("granivore (seed-eater)", "weak forest association"),
    "FruiNect": ("frugivore/nectarivore", "strong forest association"),
    "Invertebrate": ("insectivore", "moderate to strong forest association"),
    "VertFishScav": ("carnivore/scavenger", "variable forest association"),
    "Omnivore": ("omnivore", "moderate forest association"),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _forest_layer_profile(row: dict[str, str]) -> dict[str, Any] | None:
    """Read ForStrat-* percentages and produce a structured profile."""
    canopy = _to_float(row.get("ForStrat-canopy"))
    midhigh = _to_float(row.get("ForStrat-midhigh"))
    understory = _to_float(row.get("ForStrat-understory"))
    ground = _to_float(row.get("ForStrat-ground"))
    aerial = _to_float(row.get("ForStrat-aerial"))
    water_below = _to_float(row.get("ForStrat-watbelowsurf"))
    water_around = _to_float(row.get("ForStrat-wataroundsurf"))

    total = canopy + midhigh + understory + ground + aerial + water_below + water_around
    if total <= 0:
        return None

    strata = {
        "canopy": canopy,
        "midhigh": midhigh,
        "understory": understory,
        "ground": ground,
        "aerial": aerial,
        "water_below_surface": water_below,
        "water_around_surface": water_around,
    }

    dominant = max(strata, key=strata.get)
    forest_interior = canopy + midhigh + understory
    forest_share = forest_interior / total if total else 0.0

    if forest_share >= 0.7:
        if canopy >= 0.5 * total:
            niche = "canopy specialist (high arboreal forager)"
        elif midhigh >= 0.5 * total:
            niche = "mid-canopy specialist (arboreal forager)"
        elif understory >= 0.5 * total:
            niche = "understory specialist (lower-strata forager)"
        else:
            niche = "forest-interior generalist (multi-stratum)"
    elif forest_share >= 0.4:
        niche = "mixed-stratum forager (forest edge or partial canopy)"
    elif ground >= 0.6 * total:
        # Ground stratum alone is ambiguous: monals/pittas forage on the
        # forest floor; quails/larks on open ground. AVONET habitat
        # density (when present) is what disambiguates.
        niche = "ground forager (forest floor or open ground — habitat-dependent)"
    elif aerial >= 0.6 * total:
        niche = "aerial forager (open-air feeder)"
    elif (water_below + water_around) >= 0.6 * total:
        niche = "aquatic / wetland forager"
    else:
        niche = "multi-stratum / generalist forager"

    return {
        "strata": strata,
        "dominant": dominant,
        "forest_share": forest_share,
        "niche": niche,
    }


def _diet_profile(row: dict[str, str]) -> dict[str, Any] | None:
    """Read Diet-* percentages and Diet-5Cat into a structured profile."""
    diet = {
        "invertebrate": _to_float(row.get("Diet-Inv")),
        "vertebrate_endotherm": _to_float(row.get("Diet-Vend")),
        "vertebrate_ectotherm": _to_float(row.get("Diet-Vect")),
        "fish": _to_float(row.get("Diet-Vfish")),
        "vertebrate_unknown": _to_float(row.get("Diet-Vunk")),
        "scavenger": _to_float(row.get("Diet-Scav")),
        "fruit": _to_float(row.get("Diet-Fruit")),
        "nectar": _to_float(row.get("Diet-Nect")),
        "seed": _to_float(row.get("Diet-Seed")),
        "other_plant": _to_float(row.get("Diet-PlantO")),
    }
    total = sum(diet.values())
    if total <= 0:
        return None

    cat5 = (row.get("Diet-5Cat") or "").strip()
    label, forest_tag = _DIET5_TEXT.get(cat5, (cat5 or "unknown", "unknown forest association"))

    top = sorted(diet.items(), key=lambda kv: kv[1], reverse=True)
    top_items = [(name.replace("_", " "), pct) for name, pct in top if pct > 0][:3]

    return {
        "shares": diet,
        "category_5": cat5,
        "category_label": label,
        "forest_tag": forest_tag,
        "top": top_items,
    }


def _habitat_tags(
    layer: dict[str, Any] | None,
    diet: dict[str, Any] | None,
    avonet: dict[str, Any] | None = None,
) -> list[str]:
    """Explicit keyword tags so retrieval matches forest-type queries."""
    tags: list[str] = []
    if layer:
        s = layer["strata"]
        total = sum(s.values()) or 1
        if s["canopy"] / total >= 0.4:
            tags += ["forest canopy", "arboreal", "high canopy bird"]
        if s["midhigh"] / total >= 0.3:
            tags += ["mid-canopy", "subcanopy", "arboreal"]
        if s["understory"] / total >= 0.3:
            tags += ["understory", "lower-strata forager", "shrub layer"]
        if s["ground"] / total >= 0.4:
            tags += ["ground forager", "terrestrial"]
        if s["aerial"] / total >= 0.4:
            tags += ["aerial insectivore", "open-air forager"]
        if (s["water_below_surface"] + s["water_around_surface"]) / total >= 0.4:
            tags += ["aquatic", "wetland", "waterbird"]
        if layer["forest_share"] >= 0.7:
            tags += ["forest-dependent", "forest interior", "woodland"]
        elif layer["forest_share"] >= 0.4:
            tags += ["forest edge", "mixed habitat"]
        # No "open habitat" tag from stratum alone — ground-forager is
        # ambiguous (forest floor vs. open ground). AVONET density tags
        # add that signal when available.
    if diet:
        if diet["shares"]["fruit"] >= 30:
            tags += ["frugivore", "fruit eater", "seed disperser"]
        if diet["shares"]["nectar"] >= 30:
            tags += ["nectarivore", "pollinator"]
        if diet["shares"]["invertebrate"] >= 30:
            tags += ["insectivore"]
        if diet["shares"]["seed"] >= 30:
            tags += ["granivore"]
        if diet["shares"]["scavenger"] >= 20 or diet["shares"]["vertebrate_endotherm"] >= 30:
            tags += ["predator/scavenger"]

    if avonet:
        density = avonet.get("Habitat.Density")
        if isinstance(density, (int, float)):
            d = int(density)
            if d == 1:
                tags += ["dense forest", "closed canopy", "forest interior"]
            elif d == 2:
                tags += ["forest edge", "semi-open", "scrubland"]
            elif d == 3:
                tags += ["open habitat", "grassland", "sparse trees"]
        habitat = (avonet.get("Habitat") or "").strip().lower()
        if habitat:
            if "forest" in habitat:
                tags += ["forest"]
            if "wetland" in habitat:
                tags += ["wetland"]
            if "grassland" in habitat:
                tags += ["grassland"]
            if "shrub" in habitat:
                tags += ["shrubland"]
            if "rock" in habitat or "desert" in habitat:
                tags += ["arid"]
            if "human" in habitat:
                tags += ["human-modified", "urban"]

    # Dedupe while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    return unique


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_facts_block(
    *,
    scientific_name: str,
    english_name: str | None = None,
    funcdat_row: dict[str, str] | None = None,
    avonet: dict[str, Any] | None = None,
) -> str:
    """Return a markdown block of deterministic structured facts.

    `avonet` may carry any of: Habitat, Habitat.Density (int 1-3),
    Trophic.Niche, Trophic.Level, Migration (int 1-3),
    Primary.Lifestyle, Mass (grams). Missing fields are skipped.

    Returns an empty string if there is no source data to draw from —
    callers should check before appending.
    """
    layer = _forest_layer_profile(funcdat_row) if funcdat_row else None
    diet = _diet_profile(funcdat_row) if funcdat_row else None
    has_avonet = bool(avonet) and any(avonet.get(k) for k in (
        "Habitat", "Habitat.Density", "Trophic.Niche", "Trophic.Level",
        "Migration", "Primary.Lifestyle", "Mass",
    ))

    if not layer and not diet and not has_avonet:
        return ""

    lines: list[str] = ["## Structured Forest Facts"]

    if layer:
        s = layer["strata"]
        total = sum(s.values()) or 1
        pct = {k: 100.0 * v / total for k, v in s.items()}
        parts = [
            f"canopy {pct['canopy']:.0f}%",
            f"mid-canopy {pct['midhigh']:.0f}%",
            f"understory {pct['understory']:.0f}%",
            f"ground {pct['ground']:.0f}%",
            f"aerial {pct['aerial']:.0f}%",
        ]
        water = pct["water_below_surface"] + pct["water_around_surface"]
        if water > 0:
            parts.append(f"water-associated {water:.0f}%")
        lines.append("- Foraging strata: " + "; ".join(parts))
        lines.append(f"- Forest layer niche: {layer['niche']}")
        lines.append(f"- Forest-stratum share (canopy+mid+understory): {100*layer['forest_share']:.0f}%")

    if diet:
        top_str = ", ".join(f"{name} {pct:.0f}%" for name, pct in diet["top"])
        lines.append(f"- Diet category: {diet['category_label']} ({diet['forest_tag']})")
        lines.append(f"- Diet composition: {top_str}")

    if avonet:
        if avonet.get("Habitat"):
            lines.append(f"- AVONET habitat: {avonet['Habitat']}")
        density = avonet.get("Habitat.Density")
        if isinstance(density, (int, float)) and int(density) in _HABITAT_DENSITY_TEXT:
            lines.append(f"- Habitat density: {_HABITAT_DENSITY_TEXT[int(density)]}")
        if avonet.get("Trophic.Niche"):
            lines.append(f"- Trophic niche: {avonet['Trophic.Niche']}")
        if avonet.get("Trophic.Level"):
            lines.append(f"- Trophic level: {avonet['Trophic.Level']}")
        migration = avonet.get("Migration")
        if isinstance(migration, (int, float)) and int(migration) in _MIGRATION_TEXT:
            lines.append(f"- Migration strategy: {_MIGRATION_TEXT[int(migration)]}")
        if avonet.get("Primary.Lifestyle"):
            lines.append(f"- Primary lifestyle: {avonet['Primary.Lifestyle']}")
        mass = avonet.get("Mass")
        if isinstance(mass, (int, float)) and mass > 0:
            lines.append(f"- Body mass: {float(mass):.1f} g")

    if funcdat_row and (funcdat_row.get("Nocturnal") or "").strip() == "1":
        lines.append("- Activity: nocturnal")
    elif funcdat_row:
        lines.append("- Activity: diurnal")

    tags = _habitat_tags(layer, diet, avonet)
    if tags:
        lines.append("- Habitat tags: " + ", ".join(tags))

    lines.append(
        f"- Species: {english_name} ({scientific_name})" if english_name
        else f"- Species: {scientific_name}"
    )

    return "\n".join(lines)
