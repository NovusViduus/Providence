"""Hyperparameter search via RandomizedSearchCV."""

import argparse
import json
import logging
from pathlib import Path

import numpy as np
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold
from sklearn.ensemble import RandomForestClassifier

from src.data.cicids_loader import load_cicids
from src.data.preprocessor import Preprocessor
from src.features.schema import INTERSECTION_FEATURES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SAVE_DIR = Path(__file__).parent.parent.parent / "models" / "saved"


def search_rf(data_dir: str) -> None:
    X, y = load_cicids(data_dir)
    pp = Preprocessor(feature_set_name="intersection")
    X_scaled = pp.fit_transform(X)

    param_dist = {
        "n_estimators": [100, 200, 300, 500],
        "max_depth": [None, 10, 20, 30, 50],
        "min_samples_split": [2, 5, 10],
        "min_samples_leaf": [1, 2, 4],
        "class_weight": ["balanced"],
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    search = RandomizedSearchCV(
        RandomForestClassifier(random_state=42, n_jobs=-1),
        param_dist,
        n_iter=20,
        cv=cv,
        scoring="f1_macro",
        random_state=42,
        verbose=1,
        n_jobs=-1,
    )
    search.fit(X_scaled, y)

    logger.info("Best params: %s", search.best_params_)
    logger.info("Best F1 macro: %.4f", search.best_score_)

    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    with open(SAVE_DIR / "best_params_rf.json", "w") as f:
        json.dump(search.best_params_, f, indent=2, default=str)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    args = parser.parse_args()
    search_rf(args.data_dir)


if __name__ == "__main__":
    main()
