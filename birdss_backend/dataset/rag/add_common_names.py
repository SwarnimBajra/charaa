import sys
import pandas as pd
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = DATA_DIR / "species_profiles"

# Find the Excel file
excel_file = DATA_DIR / "AVONET Supplementary dataset 1.xlsx"
if not excel_file.exists():
    print(f"Error: Could not find 'AVONET Supplementary dataset 1.xlsx' in {DATA_DIR}")
    sys.exit(1)

# Step 1: Load AVONET Excel file to build a scientific-to-common name map
try:
    print("Loading AVONET Excel (this might take 10-15 seconds)...")
    xl = pd.ExcelFile(excel_file, engine='openpyxl')
    sheets = xl.sheet_names
    
    sheet_name = "AVONET1_BirdLife"
    if "AVONET2_eBird" in sheets:
        sheet_name = "AVONET2_eBird"
    elif "AVONET1_BirdLife" in sheets:
        sheet_name = "AVONET1_BirdLife"
    else:
        sheet_name = sheets[0]
        
    print(f"Reading from sheet: {sheet_name}")
    species_col = "Species2" if "eBird" in sheet_name else "Species1"
    
    # Read only the species name and English name
    avonet_df = pd.read_excel(excel_file, sheet_name=sheet_name, usecols=[species_col, "English"], engine='openpyxl')
    
    # Standardize for mapping
    avonet_df["clean_key"] = avonet_df[species_col].astype(str).str.strip().str.lower()
    name_map = dict(zip(avonet_df["clean_key"], avonet_df["English"]))
    print(f"Loaded {len(name_map)} name mappings from AVONET.")
    
except Exception as e:
    print(f"Error loading Excel file: {e}")
    sys.exit(1)

# Step 2: Process your existing text files
txt_files = list(OUTPUT_DIR.glob("*.txt"))
if not txt_files:
    print(f"No text files found in {OUTPUT_DIR}")
    sys.exit(1)

print(f"\nProcessing {len(txt_files)} existing profiles...")

success_count = 0
for filepath in txt_files:
    # 1. Deduce scientific name from filename (e.g. abroscopus_schisticeps -> Abroscopus schisticeps)
    stem = filepath.stem
    parts = stem.replace("_", " ").split()
    
    if len(parts) >= 2:
        sci_name = parts[0].capitalize() + " " + " ".join(parts[1:]).lower()
    else:
        sci_name = stem.replace("_", " ").title()
        
    clean_key = sci_name.lower().strip()
    
    # 2. Look up the English Common Name
    english_name = name_map.get(clean_key)
    if not english_name:
        # Skip if no match is found in AVONET
        continue
    
    # Ensure it's a clean string
    english_name = str(english_name).strip()
    
    # 3. Read the content of the existing file
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Avoid duplicate insertions if the file was already updated
    if f"Common Name: {english_name}" in content or f"Common Name**: {english_name}" in content:
        continue
        
    # 4. Insert the Common Name at the top
    lines = content.splitlines()
    if lines and lines[0].startswith("# Species Profile:"):
        lines.insert(1, f"\n- **Common Name**: {english_name}")
    elif lines and lines[0].startswith("Species:"):
        lines.insert(1, f"Common Name: {english_name}")
    else:
        lines.insert(0, f"- **Common Name**: {english_name}\n")
        
    # 5. Rename the file to the common name (e.g., yellow_bellied_warbler.txt)
    safe_english_name = english_name.lower().replace(" ", "_").replace("/", "_")
    new_filepath = OUTPUT_DIR / f"{safe_english_name}.txt"
    
    # Save the modified content to the new path
    with open(new_filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        
    # If the file was renamed, delete the old scientific name file
    if new_filepath.resolve() != filepath.resolve():
        filepath.unlink()
        
    success_count += 1

print(f"\nSuccessfully updated and renamed {success_count} files with English common names!")