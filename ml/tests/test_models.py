"""Tests for model wrappers."""

import numpy as np
import pytest

from src.features.schema import INTERSECTION_FEATURES, VALID_CATEGORIES
from src.models.random_forest import RandomForestModel
from src.models.gradient_boosted import XGBoostModel, LightGBMModel


def _make_synthetic_data(n=200):
    """Create synthetic training data."""
    X = np.random.randn(n, len(INTERSECTION_FEATURES))
    categories = ["BENIGN", "DOS", "PROBE", "BRUTE_FORCE"]
    y = np.array([categories[i % len(categories)] for i in range(n)])
    return X, y


class TestRandomForest:
    def test_train_and_predict(self):
        X, y = _make_synthetic_data()
        model = RandomForestModel()
        model.train(X, y, INTERSECTION_FEATURES)
        cat, conf, imp = model.predict(X[0])
        assert cat in VALID_CATEGORIES + ["BENIGN", "DOS", "PROBE", "BRUTE_FORCE"]
        assert 0.0 <= conf <= 1.0
        assert isinstance(imp, dict)
        assert all(isinstance(k, str) for k in imp.keys())
        assert all(isinstance(v, float) for v in imp.values())

    def test_save_load(self, tmp_path):
        X, y = _make_synthetic_data()
        model = RandomForestModel()
        model.train(X, y, INTERSECTION_FEATURES)
        path = str(tmp_path / "rf.joblib")
        model.save(path)
        loaded = RandomForestModel.load(path)
        cat, conf, _ = loaded.predict(X[0])
        assert cat in ["BENIGN", "DOS", "PROBE", "BRUTE_FORCE"]
        assert 0.0 <= conf <= 1.0


class TestXGBoost:
    def test_train_and_predict(self):
        X, y = _make_synthetic_data()
        model = XGBoostModel()
        model.train(X, y, INTERSECTION_FEATURES)
        cat, conf, imp = model.predict(X[0])
        assert isinstance(cat, str)
        assert 0.0 <= conf <= 1.0
        assert isinstance(imp, dict)

    def test_save_load(self, tmp_path):
        X, y = _make_synthetic_data()
        model = XGBoostModel()
        model.train(X, y, INTERSECTION_FEATURES)
        path = str(tmp_path / "xgb.joblib")
        model.save(path)
        loaded = XGBoostModel.load(path)
        cat, conf, _ = loaded.predict(X[0])
        assert isinstance(cat, str)


class TestLightGBM:
    def test_train_and_predict(self):
        X, y = _make_synthetic_data()
        model = LightGBMModel()
        model.train(X, y, INTERSECTION_FEATURES)
        cat, conf, imp = model.predict(X[0])
        assert isinstance(cat, str)
        assert 0.0 <= conf <= 1.0
        assert isinstance(imp, dict)
