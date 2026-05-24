"""
Data loading module for the MokingBird RAG system.
Supports: PDF, CSV, TXT files.
Adapted from github.com/sauhardh/ragging
"""

from pathlib import Path
from typing import List, Any

from langchain_community.document_loaders import (
    CSVLoader,
    PyPDFLoader,
    TextLoader,
)


class Data:
    """Load documents from a directory for RAG ingestion."""

    def __init__(self, data_dir: str | Path):
        self.data_path: Path = Path(data_dir).resolve()

    def load_pdfs(self, pdf_files: list, documents: list) -> list:
        for pdf_file in pdf_files:
            try:
                loader = PyPDFLoader(str(pdf_file))
                loaded = loader.load()
                # Tag each page with source metadata
                for doc in loaded:
                    doc.metadata["source_file"] = pdf_file.name
                    doc.metadata["source_type"] = "pdf"
                print(f"[INFO] Loaded {len(loaded)} pages from PDF: {pdf_file.name}")
                documents.extend(loaded)
            except Exception as e:
                print(f"[ERROR] Failed to load PDF {pdf_file}: {e}")
        return documents

    def load_csvs(self, csv_files: list, documents: list) -> list:
        for csv_file in csv_files:
            try:
                loader = CSVLoader(str(csv_file), csv_args={"delimiter": "\t"})
                loaded = loader.load()
                for doc in loaded:
                    doc.metadata["source_file"] = csv_file.name
                    doc.metadata["source_type"] = "csv"
                print(f"[INFO] Loaded {len(loaded)} rows from CSV: {csv_file.name}")
                documents.extend(loaded)
            except Exception as e:
                print(f"[ERROR] Failed to load CSV {csv_file}: {e}")
        return documents

    def load_texts(self, txt_files: list, documents: list) -> list:
        for txt_file in txt_files:
            try:
                loader = TextLoader(str(txt_file))
                loaded = loader.load()
                for doc in loaded:
                    doc.metadata["source_file"] = txt_file.name
                    doc.metadata["source_type"] = "txt"
                print(f"[INFO] Loaded {len(loaded)} docs from TXT: {txt_file.name}")
                documents.extend(loaded)
            except Exception as e:
                print(f"[ERROR] Failed to load TXT {txt_file}: {e}")
        return documents

    def load_all_docs(self) -> list:
        """Scan the data directory and load all supported file types."""
        documents: List[Any] = []

        loaders = {
            "**/*.pdf": self.load_pdfs,
            "**/*.csv": self.load_csvs,
            "**/*.txt": self.load_texts,
        }

        for pattern, loader_fn in loaders.items():
            files = list(self.data_path.glob(pattern))
            if files:
                loader_fn(files, documents)

        print(f"[INFO] Total documents loaded: {len(documents)}")
        return documents
