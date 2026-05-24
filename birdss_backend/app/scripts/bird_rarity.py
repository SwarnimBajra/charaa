import csv
import os
from functools import lru_cache

# Path to the CSV file containing bird data. Adjust if the file location changes.
CSV_PATH = os.path.join(os.path.dirname(__file__), 'nepal-species.csv')

@lru_cache(maxsize=1)
def _load_data():
    """Load CSV data into a dictionary mapping scientific name to rarity.
    The CSV is expected to have at least two columns: 'ScientificName' and
    either 'Rarity' or 'IUCNRedListCategory'.
    Returns:
        dict: {scientific_name: rarity_string}
    """
    data = {}
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV file not found at {CSV_PATH}")
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (
                row.get('ScientificName')
                or row.get('scientific_name')
                or row.get('scientificName')
            )
            rarity = (
                row.get('Rarity')
                or row.get('IUCNRedListCategory')
                or row.get('rarity')
            )
            if name:
                data[name.strip()] = rarity.strip() if rarity else None
    return data

def _rarity_to_score(rarity: str | None) -> float | None:
    """Convert a rarity category string to a numeric score between 0 and 1.
    The mapping is approximate:
        "Least Concern" -> 0.0
        "Near Threatened" -> 0.25
        "Vulnerable" -> 0.5
        "Endangered" -> 0.75
        "Critically Endangered" -> 1.0
        "Extinct" -> 1.0
    If the input is already a numeric string (e.g., "0.3"), it is converted to float.
    Returns ``None`` when the rarity is unknown or cannot be parsed.
    """
    if rarity is None:
        return None
    # Try numeric conversion first
    try:
        val = float(rarity)
        if 0.0 <= val <= 1.0:
            return val
    except ValueError:
        pass
    # Normalize string
    key = rarity.strip().lower()
    mapping = {
        "least concern": 0.0,
        "near threatened": 0.25,
        "vulnerable": 0.5,
        "endangered": 0.75,
        "critically endangered": 1.0,
        "extinct": 1.0,
    }
    return mapping.get(key)

def get_bird_rarity(scientific_name: str) -> float | None:
    """Return a numeric rarity score (0‑1) for the given bird scientific name.
    Args:
        scientific_name (str): The scientific name of the bird (e.g., "Passer domesticus").
    Returns:
        float | None: Rarity score where 0 = Least Concern and 1 = highest threat.
    """
    if not scientific_name:
        return None
    data = _load_data()
    raw = data.get(scientific_name.strip())
    return _rarity_to_score(raw)

# Example usage (can be removed in production)
if __name__ == "__main__":
    example_name = "Passer domesticus"
    try:
        print(f"Rarity of {example_name}: {get_bird_rarity(example_name)}")
    except Exception as e:
        print(e)
