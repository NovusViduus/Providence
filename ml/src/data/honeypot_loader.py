"""Honeypot data loader with two modes.

Mode A: Raw honeypot logs (session-level, limited features) → INTERSECTION_FEATURES
Mode B: Eye-processed pcaps (full feature vectors) → EYE_FULL_FEATURES
"""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from src.features.schema import INTERSECTION_FEATURES, EYE_FULL_FEATURES

logger = logging.getLogger(__name__)


def load_honeypot_raw(data_dir: str | Path) -> tuple[pd.DataFrame, pd.Series]:
    """Mode A: Load normalized honeypot JSON/Parquet from session logs.

    Extracts available flow-level features and aligns to INTERSECTION_FEATURES.
    Missing features are NaN (handled by preprocessor).

    Returns:
        (X aligned to INTERSECTION_FEATURES, y with Providence labels)
    """
    data_dir = Path(data_dir)
    files = list(data_dir.glob("*.json")) + list(data_dir.glob("*.parquet"))

    if not files:
        logger.warning("No honeypot raw data found in %s", data_dir)
        return pd.DataFrame(columns=INTERSECTION_FEATURES), pd.Series(dtype=str)

    records = []
    for f in files:
        if f.suffix == ".json":
            with open(f) as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    records.extend(data)
                else:
                    records.append(data)
        elif f.suffix == ".parquet":
            df = pd.read_parquet(f)
            records.extend(df.to_dict("records"))

    if not records:
        return pd.DataFrame(columns=INTERSECTION_FEATURES), pd.Series(dtype=str)

    raw = pd.DataFrame(records)
    feature_df = pd.DataFrame(index=range(len(raw)), columns=INTERSECTION_FEATURES, dtype=float)
    feature_df[:] = np.nan

    # Map available session fields
    if "duration_seconds" in raw.columns:
        feature_df["flow_duration"] = pd.to_numeric(raw["duration_seconds"], errors="coerce")
    if "attempts_in_session" in raw.columns:
        feature_df["packet_count"] = pd.to_numeric(raw["attempts_in_session"], errors="coerce")
    if "inter_attempt_ms" in raw.columns:
        ia = pd.to_numeric(raw["inter_attempt_ms"], errors="coerce") / 1000.0
        feature_df["inter_arrival_mean"] = ia  # will be dropped if not in feature set

    # Extract labels
    label_col = "category" if "category" in raw.columns else "label"
    if label_col not in raw.columns:
        logger.warning("No label column found in honeypot data")
        return pd.DataFrame(columns=INTERSECTION_FEATURES), pd.Series(dtype=str)

    labels = raw[label_col].str.upper()

    logger.info("Honeypot Mode A: loaded %d sessions", len(feature_df))
    dist = labels.value_counts()
    logger.info("Class distribution:\n%s", dist.to_string())

    return feature_df, labels


def load_honeypot_eye_processed(data_dir: str | Path) -> tuple[pd.DataFrame, pd.Series]:
    """Mode B: Load Eye-exported feature vectors (JSON or protobuf).

    These contain all EYE_FULL_FEATURES from The Eye's actual capture pipeline.

    Returns:
        (X aligned to EYE_FULL_FEATURES, y with Providence labels)
        Returns empty if no data exists yet.
    """
    data_dir = Path(data_dir)
    files = list(data_dir.glob("*.json")) + list(data_dir.glob("*.parquet"))

    if not files:
        logger.warning("No Eye-processed honeypot data found in %s — full-feature model deferred", data_dir)
        return pd.DataFrame(columns=EYE_FULL_FEATURES), pd.Series(dtype=str)

    records = []
    for f in files:
        if f.suffix == ".json":
            with open(f) as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    records.extend(data)
                else:
                    records.append(data)
        elif f.suffix == ".parquet":
            df = pd.read_parquet(f)
            records.extend(df.to_dict("records"))

    if not records:
        return pd.DataFrame(columns=EYE_FULL_FEATURES), pd.Series(dtype=str)

    raw = pd.DataFrame(records)

    # Extract features aligned to EYE_FULL_FEATURES
    feature_df = pd.DataFrame()
    for feat in EYE_FULL_FEATURES:
        if feat in raw.columns:
            feature_df[feat] = pd.to_numeric(raw[feat], errors="coerce")
        else:
            feature_df[feat] = np.nan

    label_col = "category" if "category" in raw.columns else "label"
    labels = raw[label_col].str.upper() if label_col in raw.columns else pd.Series(dtype=str)

    logger.info("Honeypot Mode B: loaded %d Eye-processed flows", len(feature_df))
    return feature_df, labels
