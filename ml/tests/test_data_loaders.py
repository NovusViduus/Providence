"""Tests for data loaders and preprocessor."""

import numpy as np
import pandas as pd
import pytest

from src.features.schema import INTERSECTION_FEATURES, EYE_FULL_FEATURES, VALID_CATEGORIES, CICIDS_LABEL_MAP
from src.data.preprocessor import Preprocessor


def test_intersection_is_subset_of_full():
    assert set(INTERSECTION_FEATURES).issubset(set(EYE_FULL_FEATURES))


def test_feature_counts():
    assert len(INTERSECTION_FEATURES) == 16
    assert len(EYE_FULL_FEATURES) == 31


def test_label_mapping_produces_valid_categories():
    for cicids_label, prov_label in CICIDS_LABEL_MAP.items():
        assert prov_label in VALID_CATEGORIES, f"{cicids_label} maps to invalid category {prov_label}"


def test_preprocessor_handles_nan_inf():
    pp = Preprocessor(feature_set_name="intersection")
    df = pd.DataFrame(np.random.randn(100, len(INTERSECTION_FEATURES)), columns=INTERSECTION_FEATURES)
    df.iloc[0, 0] = np.nan
    df.iloc[1, 1] = np.inf
    df.iloc[2, 2] = -np.inf

    result = pp.fit_transform(df)
    assert not np.any(np.isnan(result))
    assert not np.any(np.isinf(result))
    assert result.shape == (100, len(INTERSECTION_FEATURES))


def test_preprocessor_deterministic():
    pp = Preprocessor(feature_set_name="intersection")
    df = pd.DataFrame(np.random.randn(50, len(INTERSECTION_FEATURES)), columns=INTERSECTION_FEATURES)
    r1 = pp.fit_transform(df)
    # Re-transform same data
    r2 = pp.transform(df)
    np.testing.assert_array_almost_equal(r1, r2)


def test_preprocessor_save_load(tmp_path):
    pp = Preprocessor(feature_set_name="intersection")
    df = pd.DataFrame(np.random.randn(50, len(INTERSECTION_FEATURES)), columns=INTERSECTION_FEATURES)
    pp.fit_transform(df)

    path = tmp_path / "pp.joblib"
    pp.save(path)
    loaded = Preprocessor.load(path)

    sample = df.iloc[:5]
    r1 = pp.transform(sample)
    r2 = loaded.transform(sample)
    np.testing.assert_array_almost_equal(r1, r2)


def test_preprocessor_full_features():
    pp = Preprocessor(feature_set_name="full")
    df = pd.DataFrame(np.random.randn(50, len(EYE_FULL_FEATURES)), columns=EYE_FULL_FEATURES)
    result = pp.fit_transform(df)
    assert result.shape == (50, len(EYE_FULL_FEATURES))
