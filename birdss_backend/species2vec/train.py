"""Train the Species2Vec Word2Vec model on the corpus produced by build_corpus.py.

Uses skip-gram with negative sampling — better for rare items than CBOW, which matters
because most bird species are observed in only a handful of locations.
"""

from __future__ import annotations

import pickle
import time
from pathlib import Path

from gensim.models import Word2Vec
from gensim.models.callbacks import CallbackAny2Vec

DATA_DIR = Path(__file__).resolve().parent / "data"
MODELS_DIR = Path(__file__).resolve().parent / "models"

VECTOR_SIZE = 128
WINDOW = 999          # treat every species in a sentence as co-occurring with every other
MIN_COUNT = 5         # drop species seen in fewer than this many locations
SG = 1                # skip-gram
NEGATIVE = 15
EPOCHS = 25
WORKERS = 4
SEED = 42


class LossLogger(CallbackAny2Vec):
    def __init__(self) -> None:
        self.epoch = 0
        self.prev = 0.0

    def on_epoch_end(self, model: Word2Vec) -> None:
        self.epoch += 1
        loss = model.get_latest_training_loss()
        delta = loss - self.prev
        self.prev = loss
        print(f"  epoch {self.epoch:>2} | loss {loss:>12,.0f} | delta {delta:>12,.0f}")


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    corpus_path = DATA_DIR / "corpus.pkl"
    if not corpus_path.exists():
        raise SystemExit(f"Corpus not found at {corpus_path}. Run build_corpus.py first.")

    with open(corpus_path, "rb") as f:
        sentences = pickle.load(f)

    print(f"Loaded {len(sentences):,} sentences from {corpus_path.name}")
    print(
        f"Training Word2Vec | dim={VECTOR_SIZE} | window={WINDOW} | min_count={MIN_COUNT} "
        f"| sg={SG} | negative={NEGATIVE} | epochs={EPOCHS} | workers={WORKERS}"
    )

    t0 = time.time()
    model = Word2Vec(
        sentences=sentences,
        vector_size=VECTOR_SIZE,
        window=WINDOW,
        min_count=MIN_COUNT,
        sg=SG,
        negative=NEGATIVE,
        workers=WORKERS,
        epochs=EPOCHS,
        seed=SEED,
        compute_loss=True,
        callbacks=[LossLogger()],
    )
    elapsed = time.time() - t0
    print(
        f"\nTrained in {elapsed:.1f}s. Vocabulary: {len(model.wv):,} species "
        f"(filtered from total observed; min_count={MIN_COUNT})."
    )

    model.save(str(MODELS_DIR / "species2vec.model"))
    model.wv.save(str(MODELS_DIR / "species2vec.kv"))
    print(f"Saved full model  -> {MODELS_DIR / 'species2vec.model'}")
    print(f"Saved KeyedVectors -> {MODELS_DIR / 'species2vec.kv'}")


if __name__ == "__main__":
    main()
