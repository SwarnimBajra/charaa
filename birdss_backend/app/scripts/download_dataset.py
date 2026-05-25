"""
download_dataset.py
"""

import os
import sys

# Windows default stdout codec is cp1252, which can't encode characters like
# →, ✓, ✗ used in our progress prints below. Force UTF-8 so this script runs
# under any Python without crashing when piped/captured by another process
# (forest_health.py subprocess-runs us and turns our crash into an HTTP 500).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# config
FILE_ID = "1E7GnLMy8IznJ2Avq06ni1jjIrCkhUJW_"
FILE_NAME = "0009156-260519110011954.csv"


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, FILE_NAME)


def check_gdown():
    try:
        import gdown  # noqa: F401
    except ImportError:
        print("[!] 'gdown' is not installed. Run:  pip install gdown")
        sys.exit(1)


def download():
    import gdown

    if os.path.exists(OUTPUT_PATH):
        print(f"[i] File already exists at: {OUTPUT_PATH}")
        overwrite = input("    Overwrite? [y/N]: ").strip().lower()
        if overwrite != "y":
            print("[i] Download skipped.")
            return

    url = f"https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing"
    url = f"https://drive.google.com/uc?id={FILE_ID}"
    print(f"[→] Downloading to: {OUTPUT_PATH}")
    gdown.download(url, OUTPUT_PATH, quiet=False)  # pyright: ignore

    if os.path.exists(OUTPUT_PATH):
        size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
        print(f"[✓] Done! {FILE_NAME} ({size_mb:.2f} MB)")
    else:
        print("[✗] Download failed. Check your FILE_ID and sharing settings.")
        sys.exit(1)


if __name__ == "__main__":
    check_gdown()
    download()

