"""Build a training corpus for Species2Vec from the GBIF occurrence CSV.

Each "sentence" = the set of bird species observed in one (lat_grid_cell, lon_grid_cell, season) bucket.
Species that co-occur in many such sentences end up close in vector space after Word2Vec training.

Outputs:
    data/corpus.pkl                — list[list[str]], the training sentences
    data/species_metadata.json     — per-species observation counts + corpus stats
"""

from __future__ import annotations

import json
import pickle
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd

CSV_PATH = Path(__file__).resolve().parent.parent / "app" / "scripts" / "0009156-260519110011954.csv"
OUT_DIR = Path(__file__).resolve().parent / "data"

GRID_DEG = 0.1         # ~11km cells — more cells than 0.25° for richer context variety
MIN_SPECIES_PER_SENTENCE = 2
CHUNKSIZE = 200_000
# Group by (lat, lon, year, month) — each monthly site visit = one "sentence"
# This gives many more sentences than season-level bucketing
USECOLS = ["class", "species", "decimalLatitude", "decimalLongitude", "year", "month"]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not CSV_PATH.exists():
        raise SystemExit(f"GBIF CSV not found at {CSV_PATH}")

    cells: dict[tuple[float, float, str], set[str]] = defaultdict(set)
    species_counts: dict[str, int] = defaultdict(int)

    t0 = time.time()
    total_rows = 0
    kept_rows = 0

    print(f"Reading {CSV_PATH.name} (~774 MB) in chunks of {CHUNKSIZE:,}...")
    chunk_iter = pd.read_csv(
        CSV_PATH,
        sep="\t",
        chunksize=CHUNKSIZE,
        usecols=USECOLS,
        on_bad_lines="skip",
        low_memory=False,
    )

    for i, chunk in enumerate(chunk_iter):
        chunk = chunk[chunk["class"] == "Aves"]
        chunk = chunk.dropna(subset=["species", "decimalLatitude", "decimalLongitude", "month"])
        if chunk.empty:
            total_rows += CHUNKSIZE
            continue

        # Bin to grid cells and group by year+month (each monthly site visit = one sentence)
        chunk = chunk.assign(
            lat_bin=(chunk["decimalLatitude"] / GRID_DEG).round() * GRID_DEG,
            lon_bin=(chunk["decimalLongitude"] / GRID_DEG).round() * GRID_DEG,
            yr=chunk["year"].astype("Int64"),
            mo=chunk["month"].astype("Int64"),
        )
        chunk = chunk.dropna(subset=["yr", "mo"])

        # Collect unique species per (lat, lon, year, month) visit
        grouped = chunk.groupby(["lat_bin", "lon_bin", "yr", "mo"], sort=False)["species"].unique()
        for (lat, lon, yr, mo), species_arr in grouped.items():
            key = (round(float(lat), 2), round(float(lon), 2), int(yr), int(mo))
            cells[key].update(species_arr)

        for sp, cnt in chunk["species"].value_counts().items():
            species_counts[sp] += int(cnt)

        total_rows += len(chunk)
        kept_rows += len(chunk)
        if (i + 1) % 2 == 0:
            print(
                f"  chunk {i + 1:3d} | rows seen ~{(i + 1) * CHUNKSIZE:>10,} "
                f"| cells {len(cells):>7,} | species {len(species_counts):>5,}"
            )

    # Build sentences
    sentences = [sorted(spp) for spp in cells.values() if len(spp) >= MIN_SPECIES_PER_SENTENCE]
    avg_len = (sum(len(s) for s in sentences) / len(sentences)) if sentences else 0
    max_len = max((len(s) for s in sentences), default=0)

    elapsed = time.time() - t0
    print(
        f"\nDone in {elapsed:.1f}s. {kept_rows:,} Aves rows -> {len(cells):,} cells "
        f"-> {len(sentences):,} sentences (>= {MIN_SPECIES_PER_SENTENCE} species). "
        f"Avg sentence length {avg_len:.1f}, max {max_len}."
    )

    with open(OUT_DIR / "corpus.pkl", "wb") as f:
        pickle.dump(sentences, f, protocol=pickle.HIGHEST_PROTOCOL)

    metadata = {
        "n_sentences": len(sentences),
        "n_unique_species": len(species_counts),
        "n_cells": len(cells),
        "grid_deg": GRID_DEG,
        "min_species_per_sentence": MIN_SPECIES_PER_SENTENCE,
        "avg_sentence_length": round(avg_len, 2),
        "max_sentence_length": max_len,
        "top_50_species_by_count": dict(
            sorted(species_counts.items(), key=lambda kv: -kv[1])[:50]
        ),
        "species_counts": dict(species_counts),
    }
    with open(OUT_DIR / "species_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Saved corpus -> {OUT_DIR / 'corpus.pkl'}")
    print(f"Saved metadata -> {OUT_DIR / 'species_metadata.json'}")


if __name__ == "__main__":
    main()
