import os
import sys
import time
import pandas as pd
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv

# Load env variables
env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

if not os.environ.get("GROQ_API_KEY"):
    print("Error: GROQ_API_KEY not found in environment or .env file.")
    sys.exit(1)

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
GBIF_CSV = BASE_DIR / "0009155-260519110011954.csv"
OUTPUT_DIR = DATA_DIR / "species_profiles"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Find the Excel file
excel_file = DATA_DIR / "AVONET Supplementary dataset 1.xlsx"
if not excel_file.exists():
    print(f"Error: Could not find 'AVONET Supplementary dataset 1.xlsx' in {DATA_DIR}")
    sys.exit(1)

# Check GBIF path
if not GBIF_CSV.exists():
    print(f"Error: Could not find GBIF dataset at {GBIF_CSV}")
    sys.exit(1)

try:
    print("Step 1: Loading unique species and observation stats from GBIF dataset...")
    # Read only the necessary columns from the massive tab-separated GBIF CSV to conserve RAM
    gbif_cols = ["species", "order", "family", "stateProvince", "locality", "month", "year", "elevation", "individualCount"]
    
    # Read CSV with tab separator as defined in your prepare_csv_subset.py
    gbif_df = pd.read_csv(GBIF_CSV, sep="\t", usecols=gbif_cols, low_memory=False)
    print(f"Loaded {len(gbif_df)} occurrence records from GBIF.")
    
except Exception as e:
    print(f"Error reading GBIF CSV: {e}")
    sys.exit(1)

try:
    print("\nStep 2: Aggregating Nepal observation statistics per species...")
    gbif_df["species"] = gbif_df["species"].astype(str).str.strip()
    
    # We aggregate localities, provinces, elevations, and months in Pandas
    grouped = gbif_df.groupby("species").agg({
        "order": "first",
        "family": "first",
        "stateProvince": lambda x: set(x.dropna()),
        "locality": lambda x: set(x.dropna()),
        "month": lambda x: set(x.dropna().astype(int).astype(str)),
        "year": lambda x: set(x.dropna().astype(int).astype(str)),
        "elevation": lambda x: set(x.dropna()),
        "individualCount": lambda x: pd.to_numeric(x, errors='coerce').fillna(1).sum()
    }).reset_index()
    
    # Calculate total observation count per species
    counts = gbif_df["species"].value_counts().reset_index()
    counts.columns = ["species", "observation_count"]
    grouped = pd.merge(grouped, counts, on="species")
    
    print(f"Aggregated data. Found {len(grouped)} unique species in your GBIF download.")

except Exception as e:
    print(f"Error during aggregation: {e}")
    sys.exit(1)

try:
    print("\nStep 3: Loading AVONET Excel database...")
    xl = pd.ExcelFile(excel_file, engine='openpyxl')
    sheets = xl.sheet_names
    
    sheet_name = "AVONET1_BirdLife"
    if "AVONET2_eBird" in sheets:
        sheet_name = "AVONET2_eBird"
    elif "AVONET1_BirdLife" in sheets:
        sheet_name = "AVONET1_BirdLife"
    else:
        sheet_name = sheets[0]
        
    print(f"Reading traits from sheet: {sheet_name}")
    species_col = "Species2" if "eBird" in sheet_name else "Species1"
    
    avonet_df = pd.read_excel(
        excel_file, 
        sheet_name=sheet_name, 
        usecols=[species_col, "Habitat", "Habitat.Density", "Trophic.Niche", "Trophic.Level", "Migration", "Primary.Lifestyle", "Mass"],
        engine='openpyxl'
    )
    avonet_df.rename(columns={species_col: "scientific_name"}, inplace=True)
    
except Exception as e:
    print(f"Error loading AVONET Excel file: {e}")
    sys.exit(1)

# Standardize keys and Merge
grouped["clean_key"] = grouped["species"].str.lower()
avonet_df["clean_key"] = avonet_df["scientific_name"].astype(str).str.strip().str.lower()

merged_df = pd.merge(grouped, avonet_df, on="clean_key", how="inner")
print(f"Successfully matched {len(merged_df)} species from GBIF with AVONET records!")

# --- TESTING LIMIT ---
# Set test_only to False to process your complete database of species
test_only = False
limit = 5

species_to_process = merged_df.head(limit) if test_only else merged_df

month_names = {
    "1": "January", "2": "February", "3": "March", "4": "April",
    "5": "May", "6": "June", "7": "July", "8": "August",
    "9": "September", "10": "October", "11": "November", "12": "December",
}

for i, (_, row) in enumerate(species_to_process.iterrows(), 1):
    species_name = row["species"]
    
    filename = f"{species_name.lower().replace(' ', '_')}.txt"
    filepath = OUTPUT_DIR / filename
    
    # Skip if file already exists
    if filepath.exists():
        print(f"[{i}/{len(species_to_process)}] Skipping {species_name} (file already exists).")
        continue

    # Clean observations details from GBIF
    provinces = ", ".join(sorted(row["stateProvince"])) or "Unknown"
    localities_count = len(row["locality"])
    months_active = ", ".join(sorted([month_names.get(m, m) for m in row["month"]], key=lambda x: list(month_names.values()).index(x) if x in month_names.values() else 0)) or "Unknown"
    
    elevations = [float(e) for e in row["elevation"] if pd.notna(e)]
    elev_range = f"{min(elevations)}m - {max(elevations)}m" if elevations else "Unknown"
    
    year_range = f"{min(row['year'], default='?')} - {max(row['year'], default='?')}"
    
    # AVONET standard ecological traits
    trophic_niche = row.get("Trophic.Niche", "Unknown")
    trophic_level = row.get("Trophic.Level", "Unknown")
    habitat = row.get("Habitat", "Unknown")
    habitat_density = row.get("Habitat.Density", "Unknown")
    migration = row.get("Migration", "Unknown")
    lifestyle = row.get("Primary.Lifestyle", "Unknown")
    body_mass = row.get("Mass", "Unknown")

    print(f"[{i}/{len(species_to_process)}] Processing: {species_name}")

    prompt = f"""
You are an expert ornithologist specialized in Nepalese birds. 
Compile a beautiful, comprehensive, highly detailed species profile for the bird "{species_name}".

I have two datasets of information for this bird:

1. Real-world observation data in Nepal (from GBIF/eBird):
- Total Sightings in Nepal: {row['observation_count']}
- Total Individuals Spotted: {int(row['individualCount'])}
- Observed Provinces in Nepal: {provinces}
- Number of Distinct Localities: {localities_count}
- Months Spotted in Nepal: {months_active}
- Elevation range observed: {elev_range}
- Year range of observations: {year_range}

2. Standardized global ecological traits (from AVONET database):
- Taxonomic Family: {row['family']} (Order: {row['order']})
- Trophic Niche: {trophic_niche}
- Trophic Level: {trophic_level}
- Habitat: {habitat}
- Habitat Density: {habitat_density} (1=dense forest, 2=semi-open, 3=open)
- Migration Strategy: {migration} (1=sedentary, 2=partial, 3=full migrant)
- Primary Lifestyle: {lifestyle}
- Body Mass: {body_mass}g

Output ONLY the final completed profile in this exact format. Do not add conversational intro/outro text:

# Species Profile: {species_name}

- **Taxonomy**: Family {row['family']} (Order {row['order']})
- **Environment**: [Describe the elevations ({elev_range}), geographic provinces ({provinces}), and locations inside Nepal this bird is seen in, based on its lifestyle: {lifestyle} and habitat: {habitat}]
- **Forest Type**: [Describe the specific forest type it associates with in Nepal based on its habitat: {habitat}]
- **Forest Density**: [Explain its preferred forest density based on its Habitat Density rating of {habitat_density} and its distribution in Nepal]
- **Climate**: [Describe the climatic zones, e.g. tropical, subtropical, temperate, alpine, aligning with its observed elevation range: {elev_range}]
- **Associated Trees/Plants**: [Identify standard Nepalese trees/shrubs/plants that align with its habitat]
- **Food & Diet**: [Expand on its diet based on its Trophic Niche: {trophic_niche} and Trophic Level: {trophic_level}]
- **Seasonality**: [Describe its seasonal behavior in Nepal, integrating its global Migration strategy ({migration}) with the actual months it has been recorded active in Nepal: {months_active}]
- **Nepal Sighting Stats**: Observed across {localities_count} distinct localities. Active year range: {year_range}.
- **General Behavior**: [Describe its habits, combining its lifestyle: {lifestyle} and body mass: {body_mass}g]
"""

    try:
        chat_completion = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.1,
        )
        
        response_text = chat_completion.choices[0].message.content.strip()
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(response_text)
            
        print(f" -> Saved: {filepath.name}")
        time.sleep(2)  # Delay to respect free-tier rate limits
        
    except Exception as e:
        print(f" -> Error writing {species_name}: {e}")

print("\nProcessing complete!")