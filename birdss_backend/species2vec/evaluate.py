"""Evaluate the trained Species2Vec model.

  1. Print top-K nearest neighbours for a panel of well-known species
  2. Save those results to data/nearest_neighbors.json
  3. Project the top-N species into 2-D with t-SNE and save data/tsne.png

The nearest-neighbour outputs are also useful as a sanity check: if vultures cluster
with vultures and not with songbirds, the model is learning real ecological signal.
"""

from __future__ import annotations

import json
from pathlib import Path

from gensim.models import KeyedVectors

MODELS_DIR = Path(__file__).resolve().parent / "models"
DATA_DIR = Path(__file__).resolve().parent / "data"

QUERY_SPECIES = [
    "Gyps bengalensis",        # White-rumped vulture (raptor / scavenger)
    "Lophophorus impejanus",   # Himalayan Monal (high-altitude pheasant)
    "Milvus migrans",          # Black Kite (urban raptor)
    "Corvus splendens",        # House Crow (urban / disturbance indicator)
    "Bubo bubo",               # Eurasian Eagle-Owl (nocturnal raptor)
    "Pavo cristatus",          # Indian Peafowl (forest pheasant)
    "Dicrurus macrocercus",    # Black Drongo (open woodland)
    "Phylloscopus trochilus",  # Willow Warbler (migratory passerine)
]

TSNE_TOP_N = 300


def nearest_neighbors(kv: KeyedVectors) -> dict[str, list[dict[str, float]]]:
    out: dict[str, list[dict[str, float]]] = {}
    for sp in QUERY_SPECIES:
        if sp not in kv:
            print(f"  [skip] '{sp}' not in vocab")
            continue
        neighbors = kv.most_similar(sp, topn=10)
        print(f"\n{sp}")
        for name, score in neighbors:
            print(f"  {score:.3f}  {name}")
        out[sp] = [{"species": n, "similarity": float(s)} for n, s in neighbors]
    return out


def try_tsne(kv: KeyedVectors) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
        from sklearn.manifold import TSNE
    except ImportError as exc:
        print(f"\n[t-SNE skipped] missing dependency: {exc}")
        return

    meta_path = DATA_DIR / "species_metadata.json"
    if not meta_path.exists():
        print(f"\n[t-SNE skipped] {meta_path} not found")
        return

    meta = json.loads(meta_path.read_text())
    counts = meta.get("species_counts", {})
    top = [sp for sp, _ in sorted(counts.items(), key=lambda kv_: -kv_[1]) if sp in kv][:TSNE_TOP_N]
    if len(top) < 30:
        print(f"\n[t-SNE skipped] only {len(top)} species in both vocab and metadata")
        return

    print(f"\nRunning t-SNE on top {len(top)} species (perplexity 30)...")
    vecs = np.asarray([kv[s] for s in top])
    coords = TSNE(
        n_components=2,
        perplexity=min(30, max(5, len(top) // 4)),
        random_state=42,
        init="pca",
        learning_rate="auto",
    ).fit_transform(vecs)

    plt.figure(figsize=(14, 10))
    plt.scatter(coords[:, 0], coords[:, 1], s=14, alpha=0.55, c="#1f77b4")
    for sp in QUERY_SPECIES:
        if sp in top:
            i = top.index(sp)
            plt.annotate(
                sp,
                (coords[i, 0], coords[i, 1]),
                fontsize=9,
                fontweight="bold",
                color="#d62728",
            )
    plt.title(f"Species2Vec embeddings — t-SNE projection of top {len(top)} species")
    plt.xlabel("t-SNE dim 1")
    plt.ylabel("t-SNE dim 2")
    plt.tight_layout()
    out_path = DATA_DIR / "tsne.png"
    plt.savefig(out_path, dpi=150)
    print(f"Saved t-SNE plot -> {out_path}")


def main() -> None:
    kv_path = MODELS_DIR / "species2vec.kv"
    if not kv_path.exists():
        raise SystemExit(f"Model not found at {kv_path}. Run train.py first.")

    kv = KeyedVectors.load(str(kv_path))
    print(f"Loaded KeyedVectors: {len(kv):,} species, dim={kv.vector_size}")

    nn = nearest_neighbors(kv)
    out = DATA_DIR / "nearest_neighbors.json"
    out.write_text(json.dumps(nn, indent=2))
    print(f"\nSaved nearest neighbours -> {out}")

    try_tsne(kv)


if __name__ == "__main__":
    main()
