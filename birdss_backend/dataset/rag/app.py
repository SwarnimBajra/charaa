import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import numpy as np

# Load .env from project root
env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

from core.data import Data
from core.embedding import EmbeddingPipeline
from core.vector_store import VectorStore
from core.search import Search

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FAISS_DIR = BASE_DIR / "faiss_store"
UPLOAD_DIR = DATA_DIR / "uploads"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Global singletons (initialized in lifespan)
# ---------------------------------------------------------------------------
embd_pipeline: EmbeddingPipeline | None = None
vector_store: VectorStore | None = None
search_engine: Search | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize models and load existing index on startup."""
    global embd_pipeline, vector_store, search_engine

    print("[RAG] Initializing local embedding pipeline...")
    embd_pipeline = EmbeddingPipeline(
        model_name="all-MiniLM-L6-v2",
        chunk_size=256,
        chunk_overlap=30,
    )

    print("[RAG] Initializing vector store...")
    vector_store = VectorStore(
        model=embd_pipeline.embedding_model(),
        persist_dir=str(FAISS_DIR),
    )

    # Try to load existing index
    loaded = vector_store.load()
    if loaded:
        print(f"[RAG] Loaded existing index with {vector_store.index.ntotal} vectors.")
    else:
        print("[RAG] No existing index found. Use /rag/ingest to add documents.")

    print("[RAG] Initializing local Ollama search engine...")
    search_engine = Search(llm_model="huihui_ai/qwen2.5-abliterate:7b")

    print("[RAG] RAG system ready (Local Mode)!")
    yield

    print("[RAG] Shutting down.")


app = FastAPI(
    title="MokingBird RAG",
    description="Bird species knowledge base with local RAG-powered Q&A",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class QueryRequest(BaseModel):
    query: str
    top_k: int = 5


class QueryResponse(BaseModel):
    answer: str
    sources: list[str]
    context_used: int
    retrieved_chunks: list[dict]


class IngestResponse(BaseModel):
    status: str
    documents_loaded: int
    chunks_created: int
    vectors_added: int


class StatusResponse(BaseModel):
    index_loaded: bool
    total_vectors: int
    total_metadata: int
    data_dir: str
    files_in_data: list[str]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {"status": "healthy", "service": "MokingBird RAG", "engine": "Local Ollama"}


@app.get("/rag/status", response_model=StatusResponse)
async def rag_status():
    """Return current index stats and available data files."""
    data_files = []
    for f in DATA_DIR.rglob("*"):
        if f.is_file() and f.suffix in (".pdf", ".csv", ".txt"):
            data_files.append(str(f.relative_to(DATA_DIR)))

    return StatusResponse(
        index_loaded=vector_store.index is not None and vector_store.index.ntotal > 0,
        total_vectors=vector_store.index.ntotal if vector_store.index else 0,
        total_metadata=len(vector_store.metadata),
        data_dir=str(DATA_DIR),
        files_in_data=data_files,
    )


@app.post("/rag/query", response_model=QueryResponse)
async def rag_query(req: QueryRequest):
    """Ask a question — retrieves context from FAISS, generates answer via local Ollama."""
    if not vector_store or not vector_store.index or vector_store.index.ntotal == 0:
        raise HTTPException(
            status_code=400,
            detail="Knowledge base is empty. Upload documents or run /rag/ingest first.",
        )

    # Retrieve
    results = vector_store.query(req.query, top_k=req.top_k)

    # Generate
    answer_data = search_engine.ask(req.query, results)

    return QueryResponse(
        answer=answer_data["answer"],
        sources=answer_data["sources"],
        context_used=answer_data["context_used"],
        retrieved_chunks=results,
    )


@app.post("/rag/upload")
async def rag_upload(file: UploadFile = File(...)):
    """Upload a PDF/TXT file, chunk it, embed it, and add to the FAISS index."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".pdf", ".txt"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}. Use .pdf or .txt")

    # Save uploaded file
    dest = UPLOAD_DIR / file.filename
    with open(dest, "wb") as f:
        content = await file.read()
        f.write(content)

    print(f"[RAG] Uploaded file saved: {dest}")

    # Load, chunk, embed
    data_loader = Data(str(UPLOAD_DIR))
    documents = data_loader.load_all_docs()

    if not documents:
        raise HTTPException(status_code=400, detail="Could not extract any text from the uploaded file.")

    chunks = embd_pipeline.chunk(documents)
    embeddings = embd_pipeline.embed_chunks(chunks)

    metadatas = [
        {
            "text": chunk.page_content,
            "source_file": chunk.metadata.get("source_file", file.filename),
            "source_type": suffix.lstrip("."),
        }
        for chunk in chunks
    ]

    vector_store.add_embeddings(np.array(embeddings).astype("float32"), metadatas)
    vector_store.save()

    return {
        "status": "success",
        "filename": file.filename,
        "chunks_added": len(chunks),
        "total_vectors": vector_store.index.ntotal,
    }


@app.post("/rag/ingest", response_model=IngestResponse)
async def rag_ingest():
    """Ingest ALL files in the data/ directory into the FAISS index."""
    data_loader = Data(str(DATA_DIR))
    documents = data_loader.load_all_docs()

    if not documents:
        raise HTTPException(status_code=400, detail="No documents found in data/ directory.")

    chunks = embd_pipeline.chunk(documents)
    embeddings = embd_pipeline.embed_chunks(chunks)

    metadatas = [
        {
            "text": chunk.page_content,
            "source_file": chunk.metadata.get("source_file", "unknown"),
            "source_type": chunk.metadata.get("source_type", "unknown"),
        }
        for chunk in chunks
    ]

    vector_store.add_embeddings(np.array(embeddings).astype("float32"), metadatas)
    vector_store.save()

    return IngestResponse(
        status="success",
        documents_loaded=len(documents),
        chunks_created=len(chunks),
        vectors_added=len(embeddings),
    )


# ---------------------------------------------------------------------------
# Run directly on port 8005
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8005, reload=True)