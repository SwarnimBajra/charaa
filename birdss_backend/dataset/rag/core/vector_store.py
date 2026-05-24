"""
FAISS-based vector store for the MokingBird RAG system.
Persists index and metadata to disk for fast reload.
Adapted from github.com/sauhardh/ragging
"""

import os
import pickle
from typing import List, Any, Optional

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


class VectorStore:
    """Local FAISS vector store with metadata persistence."""

    def __init__(
        self,
        model: SentenceTransformer,
        persist_dir: str = "faiss_store",
    ):
        self.persist_dir = persist_dir
        self.index: Optional[faiss.IndexFlatL2] = None
        self.metadata: List[dict] = []
        self.model = model

        os.makedirs(self.persist_dir, exist_ok=True)
        self.faiss_path = os.path.join(self.persist_dir, "faiss.index")
        self.meta_path = os.path.join(self.persist_dir, "metadata.pkl")

    def add_embeddings(self, embeddings: np.ndarray, metadatas: List[dict]):
        """Add embedding vectors and their metadata to the index."""
        dim = embeddings.shape[1]

        if self.index is None:
            self.index = faiss.IndexFlatL2(dim)

        self.index.add(embeddings.astype("float32"))
        if metadatas:
            self.metadata.extend(metadatas)

        print(f"[INFO] Added {embeddings.shape[0]} vectors to FAISS index (total: {self.index.ntotal}).")

    def save(self):
        """Persist the FAISS index and metadata to disk."""
        if self.index is None:
            print("[WARN] No index to save.")
            return

        faiss.write_index(self.index, self.faiss_path)
        with open(self.meta_path, "wb") as f:
            pickle.dump(self.metadata, f)

        print(f"[INFO] Saved FAISS index ({self.index.ntotal} vectors) to {self.persist_dir}/")

    def load(self) -> bool:
        """Load a previously persisted FAISS index and metadata. Returns True on success."""
        if not os.path.exists(self.faiss_path) or not os.path.exists(self.meta_path):
            print("[WARN] No persisted index found. Starting fresh.")
            return False

        self.index = faiss.read_index(self.faiss_path)
        with open(self.meta_path, "rb") as f:
            self.metadata = pickle.load(f)

        print(f"[INFO] Loaded FAISS index ({self.index.ntotal} vectors, {len(self.metadata)} metadata entries).")
        return True

    def _search(self, query_embedding: np.ndarray, top_k: int = 5) -> List[dict]:
        """Internal search: find the closest vectors."""
        if self.index is None or self.index.ntotal == 0:
            print("[WARN] Index is empty, cannot search.")
            return []

        if query_embedding.ndim == 1:
            query_embedding = query_embedding.reshape(1, -1)

        distances, indices = self.index.search(query_embedding.astype("float32"), top_k)

        results = []
        for idx, dist in zip(indices[0], distances[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue
            meta = self.metadata[idx]
            results.append({
                "index": int(idx),
                "distance": float(dist),
                "text": meta.get("text", ""),
                "source_file": meta.get("source_file", "unknown"),
                "source_type": meta.get("source_type", "unknown"),
            })

        return results

    def query(self, query_text: str, top_k: int = 5) -> List[dict]:
        """Embed a query string and search the index."""
        query_emb = self.model.encode([query_text]).astype("float32")
        return self._search(query_emb, top_k=top_k)
