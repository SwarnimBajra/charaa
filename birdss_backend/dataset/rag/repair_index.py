"""
Repair an existing FAISS index without re-running Ollama.

What it does:
  1. Loads the existing FAISS index + metadata.pkl from `faiss_store/`.
  2. Groups chunks by `source_file` (each = one species), reassembles
     the original LLM narrative by joining chunks in stored order.
  3. Strips the leading "# Species Profile: ..." title line so the
     splitter no longer produces title-only chunks.
  4. Appends a deterministic "## Structured Forest Facts" block built
     from BirdFuncDat (EltonTraits) — forest strata, diet composition,
     habitat tags. AVONET fields are not re-derived (source xlsx is
     absent locally); the existing prose already encodes them.
  5. Re-chunks with the unified (256 / 30) config and re-embeds with
     sentence-transformers (local, fast — no LLM).
  6. Writes a fresh FAISS index + metadata, after backing up the old
     store to `faiss_store.bak/`.

Run from `dataset/rag/`:
    .venv/bin/python repair_index.py
"""

from __future__ import annotations

import pickle
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from core.embedding import EmbeddingPipeline
from core.vector_store import VectorStore
from core.structured_facts import BirdFuncDatLookup, build_facts_block


FAISS_DIR = BASE_DIR / "faiss_store"
BACKUP_DIR = BASE_DIR / "faiss_store.bak"
BIRDFUNCDAT = BASE_DIR.parent.parent / "app" / "scripts" / "BirdFuncDat.txt"


class SimpleDocument:
    def __init__(self, page_content: str, metadata: dict):
        self.page_content = page_content
        self.metadata = metadata


def _reassemble_narrative(chunks: list[str]) -> str:
    """Join stored chunks back into a single narrative.

    The text splitter uses overlap=30 tokens; naive concatenation can
    duplicate boundary content. We deduplicate by checking whether each
    successive chunk starts with the tail of the previous one. When no
    overlap is found we insert a newline so logical separators (e.g.
    the title line vs. the body paragraph) survive intact.
    """
    if not chunks:
        return ""
    text = chunks[0].strip()
    for nxt in chunks[1:]:
        nxt = nxt.strip()
        if not nxt:
            continue
        max_overlap = min(len(text), len(nxt), 400)
        overlap = 0
        for n in range(max_overlap, 15, -1):
            if text.endswith(nxt[:n]):
                overlap = n
                break
        sep = "" if overlap else "\n"
        text = text + sep + nxt[overlap:]
    return text.strip()


def _strip_title(text: str) -> str:
    """Drop a leading '# Species Profile: ...' line and surrounding blanks.

    Only the FIRST non-empty line is considered: if it's a markdown
    title we drop it, otherwise we leave the text alone. This is
    deliberately narrow so we don't accidentally erase real content
    that happens to be one long line starting with '#'.
    """
    lines = text.splitlines()
    # Skip leading blank lines.
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and lines[i].lstrip().startswith("#"):
        # Drop just this one title line, then any blanks that follow.
        i += 1
        while i < len(lines) and not lines[i].strip():
            i += 1
    return "\n".join(lines[i:]).strip()


def main() -> None:
    if not (FAISS_DIR / "faiss.index").exists():
        print(f"[error] No FAISS index found at {FAISS_DIR}/faiss.index")
        sys.exit(1)

    with open(FAISS_DIR / "metadata.pkl", "rb") as f:
        meta = pickle.load(f)
    print(f"[info] Loaded {len(meta)} existing chunks.")

    # Group chunks by species, preserving stored order.
    groups: dict[str, list[str]] = defaultdict(list)
    order: list[str] = []
    for m in meta:
        sp = m.get("source_file") or "unknown"
        if sp not in groups:
            order.append(sp)
        groups[sp].append(m.get("text", ""))
    print(f"[info] {len(groups)} unique species in the index.")

    funcdat = None
    if BIRDFUNCDAT.exists():
        funcdat = BirdFuncDatLookup(str(BIRDFUNCDAT))
        print(f"[info] BirdFuncDat loaded ({len(funcdat.species)} species).")
    else:
        print(f"[warn] BirdFuncDat not found at {BIRDFUNCDAT}; structured facts will be skipped.")

    # Build SimpleDocument list with enriched narratives.
    docs: list[SimpleDocument] = []
    facts_added = 0
    skipped_title_only = 0
    for sp in order:
        narrative = _reassemble_narrative(groups[sp])
        narrative = _strip_title(narrative)
        if not narrative:
            skipped_title_only += 1
            continue

        funcdat_row = funcdat.get(sp) if funcdat else None
        facts = build_facts_block(
            scientific_name=sp,
            english_name=None,
            funcdat_row=funcdat_row,
            avonet=None,
        )
        if facts:
            narrative = f"{narrative}\n\n{facts}"
            facts_added += 1

        docs.append(SimpleDocument(
            page_content=narrative,
            metadata={"source_file": sp, "source_type": "txt"},
        ))

    print(f"[info] Built {len(docs)} narratives; structured facts added to {facts_added}.")
    if skipped_title_only:
        print(f"[info] Skipped {skipped_title_only} species that had no body content.")

    # Embedding pipeline (matches the build config).
    print("[info] Initialising embedding pipeline (all-MiniLM-L6-v2, chunk=256/30)...")
    embd = EmbeddingPipeline(
        model_name="all-MiniLM-L6-v2",
        chunk_size=256,
        chunk_overlap=30,
    )

    chunks = embd.chunk(docs)
    print(f"[info] Re-chunked into {len(chunks)} chunks (was {len(meta)}).")

    t0 = time.time()
    embeddings = embd.embed_chunks(chunks)
    print(f"[info] Embedded in {time.time() - t0:.1f}s.")

    # Back up old store and write fresh one.
    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR)
    shutil.copytree(FAISS_DIR, BACKUP_DIR)
    print(f"[info] Existing store backed up to {BACKUP_DIR}/")

    # Remove old artifacts so the new index starts clean.
    for fname in ("faiss.index", "metadata.pkl"):
        target = FAISS_DIR / fname
        if target.exists():
            target.unlink()

    new_store = VectorStore(model=embd.embedding_model(), persist_dir=str(FAISS_DIR))
    new_meta = [
        {
            "text": c.page_content,
            "source_file": c.metadata.get("source_file", "unknown"),
            "source_type": "txt",
        }
        for c in chunks
    ]
    new_store.add_embeddings(np.array(embeddings).astype("float32"), new_meta)
    new_store.save()
    print(f"[done] New index written with {new_store.index.ntotal} vectors.")


if __name__ == "__main__":
    main()
