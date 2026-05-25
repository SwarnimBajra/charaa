"""Train a GradientBoosting FHI predictor from the dataset produced by
build_fhi_training_data.py.

Run on the Windows machine:
    uv run python app/scripts/train_fhi_model.py

Output:
    app/scripts/fhi_model.pkl   — pickled (model, p95_richness, feature_names)
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PATH = SCRIPT_DIR / "fhi_training_data.csv"
MODEL_PATH = SCRIPT_DIR / "fhi_model.pkl"

FEATURES = ["richness", "shannon", "dominance", "forest_dep", "mean_rarity"]
LABEL = "fhi_label"


def main() -> None:
    if not DATA_PATH.exists():
        raise SystemExit(
            f"Training data not found: {DATA_PATH}\n"
            "Run build_fhi_training_data.py first."
        )

    df = pd.read_csv(DATA_PATH)
    print(f"Loaded {len(df):,} samples from {DATA_PATH.name}")
    print(f"Label: mean={df[LABEL].mean():.3f}  std={df[LABEL].std():.3f}")

    X = df[FEATURES].values
    y = df[LABEL].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42
    )

    model = GradientBoostingRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        random_state=42,
    )

    print(f"Training GradientBoostingRegressor on {len(X_train):,} samples ...")
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_pred = np.clip(y_pred, 0.0, 1.0)

    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    print(f"Test MAE: {mae:.4f}  |  R²: {r2:.4f}")

    importances = dict(zip(FEATURES, model.feature_importances_))
    print("Feature importances:")
    for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
        bar = "█" * int(imp * 40)
        print(f"  {feat:<16} {bar} {imp:.4f}")

    # Persist model + feature list (so predictor knows the exact column order)
    artifact = {"model": model, "features": FEATURES}
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(artifact, f, protocol=pickle.HIGHEST_PROTOCOL)

    print(f"\n[ok] Model saved → {MODEL_PATH}")


if __name__ == "__main__":
    main()
