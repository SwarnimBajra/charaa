# RAG Dataset Setup

This folder contains the isolated RAG dataset ingestion pipeline for the MockingBird project.
It builds a local FAISS vector store from GBIF occurrence data and AVONET trait data.

## 1. Prerequisites

- Python `>=3.11`
- Git (optional, for branch-based workflows)
- A file system with the dataset files available locally

## 2. Create and activate a Python virtual environment

Open a terminal in `mockingbird/dataset/rag` and run:

Windows PowerShell:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

If you prefer CMD:
```cmd
python -m venv .venv
.\.venv\Scripts\activate.bat
python -m pip install --upgrade pip
```

## 3. Install dependencies

This folder uses `pyproject.toml`, so install using pip:

```powershell
python -m pip install -e .
```

If you also have a `requirements.txt` file, you can install it instead:

```powershell
python -m pip install -r requirements.txt
```

## 4. Place the required dataset files

The pipeline expects the following files in these locations:

- `mockingbird/dataset/rag/0009155-260519110011954.csv`
  - GBIF occurrence data used by the build script.
- `mockingbird/dataset/rag/data/AVONET Supplementary dataset 1.xlsx`
  - AVONET trait data.

Optional local staging files:

- `mockingbird/dataset/rag/avonet.csv`
- `mockingbird/dataset/rag/avonet.xlsx`
- `mockingbird/dataset/rag/gilf.csv`
- `mockingbird/dataset/rag/gilf.xlsx`

These optional files can be used to stage additional dataset imports or data conversions.

## 5. Build the vector database

Run the build script from the same folder:

```powershell
python .\build_final_database.py
```

This script will:

- load the GBIF CSV
- load the AVONET Excel file
- merge species metadata and traits
- create document embeddings
- persist the FAISS database under `faiss_store/`

## 6. Run the service and query it

### Local HTTP query example

Start the service with:

```powershell
python .\app.py
```

Then test it with `query.py`:

```powershell
python .\query.py
```

### Direct query via HTTP

The example service expects requests at:

```text
http://127.0.0.1:8005/rag/query
```

## 7. `.gitignore` and files to keep local

The folder is configured to ignore generated dataset and environment files so they do not get committed unintentionally.

Current ignores in `.gitignore`:

```gitignore
*.csv
*.xlsx
*.index.plk
*.txt
*.toml
requirements*.txt
*.lock
.venv/
__pycache__/
*.py[cod]
```

### Important notes

- Keep large raw datasets and local environment directories out of Git unless you intentionally want to track them.
- If you need to commit a dataset file, remove that specific pattern from `.gitignore`.

## 8. Troubleshooting

- If `build_final_database.py` fails because a file is missing, verify path and file name.
- If the FAISS index fails to load, delete `faiss_store/` and rerun the build.
- If Python dependency installation fails, make sure the virtual environment is activated and `pip` is up to date.

## 9. Package dependencies

The dependencies are defined in `pyproject.toml` and include:

- `fastapi`
- `uvicorn`
- `python-dotenv`
- `python-multipart`
- `faiss-cpu`
- `langchain`
- `langchain-community`
- `langchain-core`
- `langchain-groq`
- `langchain-text-splitters`
- `pypdf`
- `sentence-transformers`
- `tiktoken`
- `pandas`
- `openpyxl`
- `ollama`

If you want, I can also add a short `SETUP.md` and keep `README.md` focused on usage. 
