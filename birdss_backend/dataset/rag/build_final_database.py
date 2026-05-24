import os
import sys
import time
import numpy as np
import pandas as pd
from pathlib import Path
import ollama

# Import your core RAG architecture
from core.embedding import EmbeddingPipeline
from core.vector_store import VectorStore

class SimpleDocument:
    def __init__(self, page_content: str, metadata: dict):
        self.page_content = page_content
        self.metadata = metadata

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FAISS_DIR = BASE_DIR / "faiss_store"
GBIF_CSV = BASE_DIR / "0009155-260519110011954.csv"

excel_file = DATA_DIR / "AVONET Supplementary dataset 1.xlsx"
if not excel_file.exists():
    print(f"Error: Could not find 'AVONET Supplementary dataset 1.xlsx' in {DATA_DIR}")
    sys.exit(1)

if not GBIF_CSV.exists():
    print(f"Error: Could not find GBIF dataset at {GBIF_CSV}")
    sys.exit(1)

# Step 1: Initialize local RAG pipelines
print("Step 1: Initializing local RAG pipelines...")
embd_pipeline = EmbeddingPipeline(
    model_name="all-MiniLM-L6-v2",
    chunk_size=256,
    chunk_overlap=30,
)

vector_store = VectorStore(
    model=embd_pipeline.embedding_model(),
    persist_dir=str(FAISS_DIR),
)

# Load existing index
loaded = vector_store.load()
existing_sources = set()
if loaded and vector_store.metadata:
    print(f" -> Loaded existing index containing {vector_store.index.ntotal} vectors.")
    for meta in vector_store.metadata:
        if "source_file" in meta:
            existing_sources.add(meta["source_file"])
    print(f" -> Found {len(existing_sources)} species already indexed.")
else:
    print(" -> No existing FAISS index found. Creating a fresh database.")

# Step 2: Load and Aggregate GBIF data
try:
    print("\nStep 2: Loading unique species and observation stats from GBIF dataset...")
    # Loading ALL your requested features: coordinates, basisOfRecord, recordedBy, etc.
    gbif_cols = [
        "species", "order", "family", "stateProvince", "locality", 
        "month", "year", "elevation", "individualCount",
        "decimalLatitude", "decimalLongitude", "basisOfRecord", "recordedBy"
    ]
    gbif_df = pd.read_csv(GBIF_CSV, sep="\t", usecols=gbif_cols, low_memory=False)
    print(f" -> Loaded {len(gbif_df)} occurrence records from GBIF.")
    
    print("Step 3: Concatenating and aggregating Nepalese sighting features...")
    gbif_df["species"] = gbif_df["species"].astype(str).str.strip()
    
    # We aggregate and concatenate coordinates, basisOfRecord, and observers
    grouped = gbif_df.groupby("species").agg({
        "order": "first",
        "family": "first",
        "stateProvince": lambda x: set(x.dropna()),
        "locality": lambda x: set(x.dropna()),
        "month": lambda x: set(x.dropna().astype(int).astype(str)),
        "year": lambda x: set(x.dropna().astype(int).astype(str)),
        "elevation": lambda x: set(x.dropna()),
        "individualCount": lambda x: pd.to_numeric(x, errors='coerce').fillna(1).sum(),
        # 1. Bounding box coordinates
        "decimalLatitude": lambda x: (x.min(), x.max()) if x.notna().any() else (None, None),
        "decimalLongitude": lambda x: (x.min(), x.max()) if x.notna().any() else (None, None),
        # 2. Main collection method (basisOfRecord)
        "basisOfRecord": lambda x: x.mode()[0] if not x.mode().empty else "Unknown",
        # 3. Citizen Science effort (unique observers)
        "recordedBy": lambda x: len(x.dropna().unique())
    }).reset_index()
    
    counts = gbif_df["species"].value_counts().reset_index()
    counts.columns = ["species", "observation_count"]
    grouped = pd.merge(grouped, counts, on="species")
    print(f" -> Aggregated data. Found {len(grouped)} unique species in Nepal.")
    
except Exception as e:
    print(f"Error reading/aggregating GBIF data: {e}")
    sys.exit(1)

# Step 3: Load AVONET data with Dynamic Column Detection
try:
    print("\nStep 4: Loading AVONET Excel database...")
    xl = pd.ExcelFile(excel_file, engine='openpyxl')
    sheets = xl.sheet_names
    
    sheet_name = "AVONET2_eBird" if "AVONET2_eBird" in sheets else "AVONET1_BirdLife"
    print(f" -> Reading traits from sheet: {sheet_name}")
    
    avonet_header = pd.read_excel(excel_file, sheet_name=sheet_name, nrows=3, engine='openpyxl')
    columns = list(avonet_header.columns)
    
    species_col = "Species2" if "eBird" in sheet_name else "Species1"
    if species_col not in columns:
        for col in columns:
            if "species" in col.lower():
                species_col = col
                break
                
    english_col = None
    for col in columns:
        if "english" in col.lower() or "common" in col.lower():
            english_col = col
            break
            
    habitat_col = None
    for col in columns:
        if "habitat" in col.lower() and "density" not in col.lower():
            habitat_col = col
            break
            
    density_col = None
    for col in columns:
        if "density" in col.lower():
            density_col = col
            break
            
    niche_col = None
    for col in columns:
        if "niche" in col.lower() or "trophic.niche" in col.lower():
            niche_col = col
            break
            
    level_col = None
    for col in columns:
        if "level" in col.lower():
            level_col = col
            break
            
    migration_col = None
    for col in columns:
        if "migration" in col.lower():
            migration_col = col
            break
            
    lifestyle_col = None
    for col in columns:
        if "lifestyle" in col.lower():
            lifestyle_col = col
            break
            
    mass_col = None
    for col in columns:
        if "mass" in col.lower() or "bodymass" in col.lower():
            mass_col = col
            break

    columns_to_load = [species_col]
    mapping = {species_col: "scientific_name"}
    
    if english_col:
        columns_to_load.append(english_col)
        mapping[english_col] = "English"
    if habitat_col:
        columns_to_load.append(habitat_col)
        mapping[habitat_col] = "Habitat"
    if density_col:
        columns_to_load.append(density_col)
        mapping[density_col] = "Habitat.Density"
    if niche_col:
        columns_to_load.append(niche_col)
        mapping[niche_col] = "Trophic.Niche"
    if level_col:
        columns_to_load.append(level_col)
        mapping[level_col] = "Trophic.Level"
    if migration_col:
        columns_to_load.append(migration_col)
        mapping[migration_col] = "Migration"
    if lifestyle_col:
        columns_to_load.append(lifestyle_col)
        mapping[lifestyle_col] = "Primary.Lifestyle"
    if mass_col:
        columns_to_load.append(mass_col)
        mapping[mass_col] = "Mass"
    
    avonet_df = pd.read_excel(excel_file, sheet_name=sheet_name, usecols=columns_to_load, engine='openpyxl')
    avonet_df.rename(columns=mapping, inplace=True)
    
except Exception as e:
    print(f"Error loading AVONET Excel file: {e}")
    sys.exit(1)

# Standardize keys and Merge
grouped["clean_key"] = grouped["species"].str.lower()
avonet_df["clean_key"] = avonet_df["scientific_name"].astype(str).str.strip().str.lower()

merged_df = pd.merge(grouped, avonet_df, on="clean_key", how="inner")
print(f" -> Successfully matched {len(merged_df)} species from GBIF with AVONET records!")

# --- CONFIGURATION LIMIT ---
test_only = False
limit = 5

species_to_process = merged_df.head(limit) if test_only else merged_df

month_names = {
    "1": "January", "2": "February", "3": "March", "4": "April",
    "5": "May", "6": "June", "7": "July", "8": "August",
    "9": "September", "10": "October", "11": "November", "12": "December",
}

print(f"\nStep 5: Beginning local LLM synthesis & direct vector ingestion for {len(species_to_process)} species...")

for i, (_, row) in enumerate(species_to_process.iterrows(), 1):
    species_name = row["species"]
    english_name = str(row.get("English", species_name)).strip()
    
    source_filename = english_name 
    
    if source_filename in existing_sources:
        print(f"[{i}/{len(species_to_process)}] Skipping {english_name} (already in vector database).")
        continue

    # Extract GBIF features
    provinces = ", ".join(sorted(row["stateProvince"])) or "Unknown"
    localities_count = len(row["locality"])
    months_active = ", ".join(sorted([month_names.get(m, m) for m in row["month"]], key=lambda x: list(month_names.values()).index(x) if x in month_names.values() else 0)) or "Unknown"
    
    elevations = [float(e) for e in row["elevation"] if pd.notna(e)]
    elev_range = f"{min(elevations)}m - {max(elevations)}m" if elevations else "Unknown"
    year_range = f"{min(row['year'], default='?')} - {max(row['year'], default='?')}"
    
    # 1. CONCATENATE LATITUDE/LONGITUDE BOUNDARIES
    lat_min, lat_max = row["decimalLatitude"]
    lon_min, lon_max = row["decimalLongitude"]
    geo_boundary = f"Latitudes {lat_min:.4f} to {lat_max:.4f}, Longitudes {lon_min:.4f} to {lon_max:.4f}" if lat_min else "Unknown"
    
    # 2. CONCATENATE BASIS OF RECORD & OBSERVERS
    basis_of_record = row["basisOfRecord"]
    observer_count = row["recordedBy"]
    
    # Extract AVONET features
    trophic_niche = row.get("Trophic.Niche", "Unknown")
    trophic_level = row.get("Trophic.Level", "Unknown")
    habitat = row.get("Habitat", "Unknown")
    habitat_density = row.get("Habitat.Density", "Unknown")
    migration = row.get("Migration", "Unknown")
    lifestyle = row.get("Primary.Lifestyle", "Unknown")
    body_mass = row.get("Mass", "Unknown")

    print(f"[{i}/{len(species_to_process)}] Synthesizing & Ingesting: {english_name} ({species_name})")

    # The prompt explicitly utilizes the coordinate bounds, observers, and record basis
    prompt = f"""
You are an expert ornithologist specialized in Nepalese birds. 
Write a highly detailed, comprehensive, and cohesive narrative-style ecological and observational profile for the bird "{english_name}" ({species_name}).

You must incorporate EVERY single feature and statistic from the two datasets below into a natural, flowing paragraph narrative. Do not summarize or omit any numbers, names, or metrics:

1. Real-world observation data in Nepal (from GBIF/eBird):
- Total Sightings in Nepal: {row['observation_count']}
- Total Individuals Spotted: {int(row['individualCount'])}
- Observed Provinces in Nepal: {provinces}
- Number of Distinct Localities: {localities_count}
- Geographic Bounding Box in Nepal: {geo_boundary}
- Main Observation Method (Basis of Record): {basis_of_record}
- Number of Unique Citizen Scientists/Observers: {observer_count}
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

Structure the response as a title followed by 2 or 3 dense, continuous paragraphs. 
Ensure all the scientific metrics are preserved. Do not add conversational intro/outro text.
"""

    start_time = time.time()
    try:
        response = ollama.chat(
            model="huihui_ai/qwen2.5-abliterate:7b",
            messages=[
                {
                    "role": "system", 
                    "content": "You are a precise scientific database generator. Do not include any introductory remarks, greetings, conversational text, or polite summaries (e.g. do not say 'Here is the profile'). Start your response directly with the title '# Species Profile:' and write only the narrative paragraphs requested."
                },
                {
                    "role": "user", 
                    "content": prompt
                }
            ],
            options={"temperature": 0.1}
        )
        response_text = response['message']['content'].strip()
        
        # PYTHON POST-PROCESSING: 100% Foolproof Clean
        if "#" in response_text:
            response_text = response_text[response_text.find("#"):]
            
        # TERMINAL PREVIEW: Shows first 250 characters of the paragraph
        print("-" * 65)
        print(f"GENERATED NARRATIVE PREVIEW FOR {english_name.upper()}:")
        print(response_text[:250] + "...")
        print("-" * 65)
        
        # Convert raw string into a SimpleDocument chunk
        doc = SimpleDocument(
            page_content=response_text,
            metadata={"source_file": source_filename, "source_type": "txt"}
        )
        
        # Chunk and Embed the document
        chunks = embd_pipeline.chunk([doc])
        embeddings = embd_pipeline.embed_chunks(chunks)
        
        # Prepare metadata formats matching your app's standard
        metadatas = [
            {
                "text": chunk.page_content,
                "source_file": chunk.metadata.get("source_file", source_filename),
                "source_type": "txt"
            }
            for chunk in chunks
        ]
        
        # Add directly to FAISS vector database
        vector_store.add_embeddings(np.array(embeddings).astype("float32"), metadatas)
        
        # Save FAISS index state incrementally after every species
        vector_store.save()
        
        elapsed = time.time() - start_time
        print(f" -> Successfully Indexed in FAISS (Process time: {elapsed:.2f} seconds)\n")
        
    except Exception as e:
        print(f" -> Error processing/ingesting {english_name}: {e}\n")

print("\nProcessing and Direct Ingestion Complete!")