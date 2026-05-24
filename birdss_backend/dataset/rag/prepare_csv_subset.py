"""
Prepare a small subset of the GBIF eBird occurrence CSV for RAG ingestion.
Reads the first N rows, extracts bird-relevant columns, and writes
human-readable text documents that the RAG system can index.

Usage:
  uv run python prepare_csv_subset.py
"""

import csv
import os
from pathlib import Path
from collections import defaultdict

# Source CSV (tab-separated GBIF export)
CSV_PATH = Path(__file__).resolve().parent.parent / "0009155-260519110011954.csv"
OUTPUT_DIR = Path(__file__).resolve().parent / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_ROWS = 2000  # Read first N rows from the massive CSV


def main():
    print(f"[INFO] Reading first {MAX_ROWS} rows from: {CSV_PATH.name}")

    species_data = defaultdict(lambda: {
        "scientific_name": "",
        "order": "",
        "family": "",
        "genus": "",
        "localities": set(),
        "provinces": set(),
        "months": set(),
        "years": set(),
        "elevations": set(),
        "total_count": 0,
        "observation_count": 0,
    })

    row_count = 0
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")

        for row in reader:
            row_count += 1
            if row_count > MAX_ROWS:
                break

            species = row.get("species", "").strip()
            if not species:
                continue

            d = species_data[species]
            d["scientific_name"] = row.get("scientificName", species)
            d["order"] = row.get("order", "")
            d["family"] = row.get("family", "")
            d["genus"] = row.get("genus", "")

            locality = row.get("locality", "")
            if locality:
                d["localities"].add(locality)

            province = row.get("stateProvince", "")
            if province:
                d["provinces"].add(province)

            month = row.get("month", "")
            if month:
                d["months"].add(month)

            year = row.get("year", "")
            if year:
                d["years"].add(year)

            elev = row.get("elevation", "")
            if elev:
                d["elevations"].add(elev)

            count_str = row.get("individualCount", "")
            try:
                count = int(count_str)
            except (ValueError, TypeError):
                count = 1
            d["total_count"] += count
            d["observation_count"] += 1

    print(f"[INFO] Parsed {row_count} rows, found {len(species_data)} unique species.")

    # Write one text file per species
    species_dir = OUTPUT_DIR / "species_profiles"
    species_dir.mkdir(parents=True, exist_ok=True)

    month_names = {
        "1": "January", "2": "February", "3": "March", "4": "April",
        "5": "May", "6": "June", "7": "July", "8": "August",
        "9": "September", "10": "October", "11": "November", "12": "December",
    }

    for species, d in sorted(species_data.items()):
        safe_name = species.replace(" ", "_").replace("/", "_")
        filepath = species_dir / f"{safe_name}.txt"

        months_readable = sorted([month_names.get(m, m) for m in d["months"]])
        elevations = sorted([e for e in d["elevations"] if e])

        lines = [
            f"Species: {species}",
            f"Scientific Name: {d['scientific_name']}",
            f"Order: {d['order']}",
            f"Family: {d['family']}",
            f"Genus: {d['genus']}",
            f"Country: Nepal",
            "",
            f"Total observations in dataset: {d['observation_count']}",
            f"Total individuals counted: {d['total_count']}",
            "",
            f"Provinces observed in: {', '.join(sorted(d['provinces'])) or 'Unknown'}",
            f"Localities: {', '.join(sorted(d['localities'])) or 'Unknown'}",
            "",
            f"Months active: {', '.join(months_readable) or 'Unknown'}",
            f"Year range: {min(d['years'], default='?')} - {max(d['years'], default='?')}",
        ]

        if elevations:
            lines.append(f"Elevation range observed: {min(elevations)}m - {max(elevations)}m")

        lines.append("")
        lines.append(f"This species belongs to the family {d['family']} (order {d['order']}).")
        lines.append(f"It has been observed in {len(d['localities'])} distinct localities across Nepal.")

        with open(filepath, "w", encoding="utf-8") as out:
            out.write("\n".join(lines))

    print(f"[INFO] Wrote {len(species_data)} species profile files to {species_dir}/")

    # Also write a summary CSV for the RAG data directory
    summary_path = OUTPUT_DIR / "nepal_bird_species_summary.csv"
    with open(summary_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["species", "scientific_name", "family", "order", "observations", "provinces", "months_active"])
        for species, d in sorted(species_data.items()):
            months_readable = sorted([month_names.get(m, m) for m in d["months"]])
            writer.writerow([
                species,
                d["scientific_name"],
                d["family"],
                d["order"],
                d["observation_count"],
                "; ".join(sorted(d["provinces"])),
                "; ".join(months_readable),
            ])

    print(f"[INFO] Wrote summary CSV: {summary_path}")
    print("[DONE] Data preparation complete. Run '/rag/ingest' to index these files.")


if __name__ == "__main__":
    main()
