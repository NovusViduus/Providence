"""Unified preprocessing pipeline for Providence ML.

Handles both INTERSECTION_FEATURES and EYE_FULL_FEATURES.
Saves fitted preprocessor artifacts for inference server use.
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from src.features.schema import INTERSECTION_FEATURES, EYE_FULL_FEATURES

logger = logging.getLogger(__name__)


class Preprocessor:
    """Fit/transform pipeline: impute NaN/Inf, then StandardScaler."""

    def __init__(self, feature_set_name: str = "intersection"):
        self.feature_set_name = feature_set_name
        self.feature_set = INTERSECTION_FEATURES if feature_set_name == "intersection" else EYE_FULL_FEATURES
        self.scaler = StandardScaler()
        self._medians: np.ndarray | None = None
        self._fitted = False

    def fit_transform(self, X: pd.DataFrame) -> np.ndarray:
        """Fit on training data and return transformed array."""
        X = X[self.feature_set].copy()
        X = X.replace([np.inf, -np.inf], np.nan)
        self._medians = X.median().values
        X = X.fillna(pd.Series(self._medians, index=self.feature_set))
        result = self.scaler.fit_transform(X.values)
        self._fitted = True
        return result

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        """Transform using fitted parameters."""
        if not self._fitted:
            raise RuntimeError("Preprocessor not fitted yet")
        X = X[self.feature_set].copy()
        X = X.replace([np.inf, -np.inf], np.nan)
        X = X.fillna(pd.Series(self._medians, index=self.feature_set))
        return self.scaler.transform(X.values)

    def transform_array(self, arr: np.ndarray) -> np.ndarray:
        """Transform a single numpy array (for inference)."""
        if not self._fitted:
            raise RuntimeError("Preprocessor not fitted yet")
        arr = np.where(np.isinf(arr), np.nan, arr)
        nan_mask = np.isnan(arr)
        if nan_mask.any():
            arr = np.where(nan_mask, self._medians, arr)
        return self.scaler.transform(arr.reshape(1, -1))

    def save(self, path: str | Path) -> None:
        """Save fitted preprocessor to disk."""
        joblib.dump({
            "feature_set_name": self.feature_set_name,
            "feature_set": self.feature_set,
            "scaler": self.scaler,
            "medians": self._medians,
            "fitted": self._fitted,
        }, path)
        logger.info("Preprocessor saved to %s", path)

    @classmethod
    def load(cls, path: str | Path) -> "Preprocessor":
        """Load a fitted preprocessor from disk."""
        data = joblib.load(path)
        pp = cls(feature_set_name=data["feature_set_name"])
        pp.scaler = data["scaler"]
        pp._medians = data["medians"]
        pp._fitted = data["fitted"]
        pp.feature_set = data["feature_set"]
        return pp


def combine_datasets(*dataset_tuples: tuple[pd.DataFrame, pd.Series, str]) -> tuple[pd.DataFrame, pd.Series]:
    """Concatenate multiple (X, y, source_name) tuples.

    Returns combined (X, y). Adds 'data_source' column for provenance (not a model feature).
    """
    all_x, all_y = [], []
    for X, y, source in dataset_tuples:
        X = X.copy()
        X["_data_source"] = source
        all_x.append(X)
        all_y.append(y)

    combined_x = pd.concat(all_x, ignore_index=True)
    combined_y = pd.concat(all_y, ignore_index=True)

    sources = combined_x["_data_source"].value_counts()
    logger.info("Combined dataset sources:\n%s", sources.to_string())
    combined_x = combined_x.drop(columns=["_data_source"])

    return combined_x, combined_y
