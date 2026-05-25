"""Build FHI training dataset from GBIF CSV (2020+ observations only).

Reads the 774 MB GBIF occurrence CSV, keeps only Aves records from 2020+,
bins observations into 0.5-degree grid cells, computes 5 ecological feature
columns per cell, and writes a composite health label normalized against the
recent-data distribution (not a 30-year historical average).

Run on the Windows machine:
    uv run python app/scripts/build_fhi_training_data.py

Output:
    app/scripts/fhi_training_data.csv   (~one row per grid cell)
"""

from __future__ import annotations

import csv as csv_mod
import math
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
CSV_PATH = SCRIPT_DIR / "0009156-260519110011954.csv"
BIRDFUNC_PATH = SCRIPT_DIR / "BirdFuncDat.txt"
OUT_PATH = SCRIPT_DIR / "fhi_training_data.csv"

GRID_DEG = 0.5
MIN_SPECIES = 3
RECENT_YEAR = 2020
CHUNKSIZE = 200_000

# Composite label weights (native excluded — can't derive reliably per grid cell)
W_SHANNON = 0.32
W_RICHNESS = 0.19
W_DOMINANCE = 0.13
W_FOREST_DEP = 0.25
W_RARITY = 0.11


# ── BirdFuncDat helpers ───────────────────────────────────────────────────

def _fv(row: dict, key: str) -> float:
    try:
        return float(row.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def _compute_forest_dep(row: dict) -> float:
    ground = _fv(row, "ForStrat-ground")
    under = _fv(row, "ForStrat-understory")
    mid = _fv(row, "ForStrat-midhigh")
    can = _fv(row, "ForStrat-canopy")
    aerial = _fv(row, "ForStrat-aerial")
    wb = _fv(row, "ForStrat-watbelowsurf")
    wa = _fv(row, "ForStrat-wataroundsurf")
    total_s = ground + under + mid + can + aerial + wb + wa
    strat = (0.25 * ground + 1.0 * under + 1.0 * mid + 0.95 * can + 0.15 * aerial) / total_s if total_s else 0.0

    inv = _fv(row, "Diet-Inv"); fruit = _fv(row, "Diet-Fruit"); nect = _fv(row, "Diet-Nect")
    seed = _fv(row, "Diet-Seed"); scav = _fv(row, "Diet-Scav")
    vend = _fv(row, "Diet-Vend"); vect = _fv(row, "Diet-Vect"); vfish = _fv(row, "Diet-Vfish")
    vunk = _fv(row, "Diet-Vunk"); planto = _fv(row, "Diet-PlantO")
    total_d = inv + fruit + nect + seed + scav + vend + vect + vfish + vunk + planto
    diet = (0.5 * inv + 1.0 * fruit + 0.9 * nect + 0.05 * seed) / total_d if total_d else 0.0

    return round(min(0.6 * strat + 0.4 * diet, 1.0), 4)


def load_birdfunc(path: Path) -> dict[str, float]:
    db: dict[str, float] = {}
    try:
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv_mod.DictReader(f, delimiter="\t")
            for row in reader:
                name = (row.get("Scientific") or "").strip().lower()
                if name:
                    db[name] = _compute_forest_dep(row)
        print(f"[ok] BirdFuncDat: {len(db):,} species loaded")
    except Exception as e:
        print(f"[warn] BirdFuncDat load failed: {e} — forest_dep defaults to 0.4")
    return db


# ── Feature computation per cell ─────────────────────────────────────────

def shannon_idx(counts: list[int]) -> float:
    total = sum(counts)
    if total == 0:
        return 0.0
    h = 0.0
    for c in counts:
        p = c / total
        if p > 0:
            h -= p * math.log(p)
    return h


def dominance_score(counts: list[int]) -> float:
    total = sum(counts)
    return max(counts) / total if total else 0.0


def compute_cell_features(
    species_counts: dict[str, int],
    global_counts: dict[str, int],
    birdfunc: dict[str, float],
) -> dict:
    names = list(species_counts.keys())
    counts = [species_counts[n] for n in names]
    total = sum(counts)
    richness = len(names)

    sh = shannon_idx(counts)
    dom = dominance_score(counts)

    fd_score = 0.0
    for name, cnt in zip(names, counts):
        fd = birdfunc.get(name.lower())
        fd_score += (cnt / total) * (fd if fd is not None else 0.4)

    rarity_vals = [1.0 / math.log(global_counts.get(n, 1) + 10) for n in names]
    mean_rarity = sum(rarity_vals) / len(rarity_vals)

    return {
        "richness": richness,
        "shannon": round(sh, 4),
        "dominance": round(dom, 4),
        "forest_dep": round(fd_score, 4),
        "mean_rarity": round(mean_rarity, 4),
    }


# ── Main ─────────────────────────────────────────────────────────────────

def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"GBIF CSV not found: {CSV_PATH}")

    birdfunc = load_birdfunc(BIRDFUNC_PATH)

    cells: dict[tuple[float, float], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    global_counts: dict[str, int] = defaultdict(int)

    usecols = ["class", "species", "decimalLatitude", "decimalLongitude", "year", "eventDate"]
    t0 = time.time()
    total_kept = 0

    print(f"Reading {CSV_PATH.name} in {CHUNKSIZE:,}-row chunks (Aves, year >= {RECENT_YEAR}) ...")
    chunk_iter = pd.read_csv(
        CSV_PATH,
        sep="\t",
        chunksize=CHUNKSIZE,
        usecols=usecols,
        on_bad_lines="skip",
        low_memory=False,
    )

    for i, chunk in enumerate(chunk_iter):
        chunk = chunk[chunk["class"] == "Aves"]
        chunk = chunk.dropna(subset=["species", "decimalLatitude", "decimalLongitude"])

        if "year" in chunk.columns:
            yr = pd.to_numeric(chunk["year"], errors="coerce")
        else:
            yr = pd.to_numeric(chunk["eventDate"].astype(str).str[:4], errors="coerce")
        chunk = chunk[yr >= RECENT_YEAR]

        if chunk.empty:
            continue

        chunk = chunk.assign(
            lat_bin=(chunk["decimalLatitude"] / GRID_DEG).round() * GRID_DEG,
            lon_bin=(chunk["decimalLongitude"] / GRID_DEG).round() * GRID_DEG,
        )

        grouped = chunk.groupby(["lat_bin", "lon_bin", "species"], sort=False).size()
        for (lat, lon, sp), cnt in grouped.items():
            key = (round(float(lat), 1), round(float(lon), 1))
            sp = str(sp).strip()
            if sp:
                cells[key][sp] += int(cnt)
                global_counts[sp] += int(cnt)

        total_kept += len(chunk)
        if (i + 1) % 5 == 0:
            print(f"  chunk {i+1:3d} | kept {total_kept:>8,} rows | cells {len(cells):>6,}")

    elapsed = time.time() - t0
    print(f"Done in {elapsed:.1f}s. {total_kept:,} rows → {len(cells):,} cells.")

    rows_out = []
    skipped = 0
    for (lat, lon), sp_counts in cells.items():
        if len(sp_counts) < MIN_SPECIES:
            skipped += 1
            continue
        feats = compute_cell_features(sp_counts, global_counts, birdfunc)
        feats["lat"] = lat
        feats["lon"] = lon
        rows_out.append(feats)

    print(f"Cells kept (>= {MIN_SPECIES} species): {len(rows_out):,}  skipped: {skipped:,}")
    if not rows_out:
        raise SystemExit("No training samples generated. Check RECENT_YEAR or CSV path.")

    df = pd.DataFrame(rows_out)

    # Normalize richness against 95th-percentile of 2020+ data — this is the "current baseline"
    p95_richness = max(df["richness"].quantile(0.95), 1)
    df["norm_richness"] = (df["richness"] / p95_richness).clip(upper=1.0)

    df["norm_shannon"] = df.apply(
        lambda r: min(r["shannon"] / math.log(r["richness"]), 1.0) if r["richness"] > 1 else 1.0,
        axis=1,
    )
    df["norm_dominance"] = 1.0 - df["dominance"]

    df["fhi_label"] = (
        W_SHANNON * df["norm_shannon"]
        + W_RICHNESS * df["norm_richness"]
        + W_DOMINANCE * df["norm_dominance"]
        + W_FOREST_DEP * df["forest_dep"]
        + W_RARITY * df["mean_rarity"]
    ).clip(0.0, 1.0).round(4)

    print(f"\nLabel distribution:\n{df['fhi_label'].describe().round(4)}")

    out_cols = ["richness", "shannon", "dominance", "forest_dep", "mean_rarity", "fhi_label", "lat", "lon"]
    df[out_cols].to_csv(OUT_PATH, index=False)
    print(f"\n[ok] {len(df):,} training samples → {OUT_PATH}")


if __name__ == "__main__":
    main()
