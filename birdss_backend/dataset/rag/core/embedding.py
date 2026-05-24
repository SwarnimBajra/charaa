"""
Embedding pipeline for the MokingBird RAG system.
Uses SentenceTransformer (all-MiniLM-L6-v2) for local CPU-only embeddings.
Adapted from github.com/sauhardh/ragging
"""

from typing import List, Any

import numpy as np
import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer


class EmbeddingPipeline:
    """Chunk documents and generate embeddings."""

    def __init__(
        self,
        model_name: str = "all-MiniLM-L6-v2",
        chunk_size: int = 200,
        chunk_overlap: int = 40,
        token_model: str = "cl100k_base",
    ):
        self.chunk_size = chunk_size
        self.overlap_size = chunk_overlap
        self.model = SentenceTransformer(model_name)
        self.enc = tiktoken.get_encoding(token_model)
        print(f"[INFO] Embedding model loaded: {model_name}")

    def _token_len(self, text: str) -> int:
        return len(self.enc.encode(text))

    def embedding_model(self) -> SentenceTransformer:
        """Returns the active embedding model."""
        return self.model

    def chunk(self, documents: List[Any]) -> List[Any]:
        """Split documents into overlapping chunks."""
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.overlap_size,
            length_function=self._token_len,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

        chunks = text_splitter.split_documents(documents)
        print(f"[INFO] Split {len(documents)} documents into {len(chunks)} chunks.")
        return chunks

    def embed_chunks(self, chunks: List[Any]) -> np.ndarray:
        """Generate embeddings for a list of chunks."""
        texts = [chunk.page_content for chunk in chunks]
        embeddings = self.model.encode(texts, show_progress_bar=True)
        print(f"[INFO] Generated {len(embeddings)} embeddings (dim={embeddings.shape[1]}).")
        return embeddings
