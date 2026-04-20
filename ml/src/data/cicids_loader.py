"""CICIDS2017/2018 dataset loader.

Loads CSV files, cleans data, maps labels to Providence taxonomy,
and extracts only INTERSECTION_FEATURES (no approximate mappings).
"""

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from src.features.schema import (
    CICIDS_COLUMN_MAP,
    CICIDS_LABEL_MAP,
    INTERSECTION_FEATURES,
)

logger = logging.getLogger(__name__)


def load_cicids(data_dir: str | Path) -> tuple[pd.DataFrame, pd.Series]:
    """Load CICIDS2017 CSV files and return (X, y) aligned to INTERSECTION_FEATURES.

    Args:
        data_dir: Path to directory containing CICIDS CSV files.

    Returns:
        Tuple of (features DataFrame, labels Series) with Providence categories.
    """
    data_dir = Path(data_dir)
    csv_files = sorted(data_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {data_dir}")

    frames = []
    for f in csv_files:
        logger.info("Loading %s", f.name)
        try:
            df = pd.read_csv(f, encoding="utf-8", low_memory=False)
        except UnicodeDecodeError:
            df = pd.read_csv(f, encoding="latin-1", low_memory=False)
        frames.append(df)

    raw = pd.concat(frames, ignore_index=True)
    logger.info("Raw rows: %d, columns: %d", len(raw), len(raw.columns))

    # Strip whitespace from column names
    raw.columns = raw.columns.str.strip()

    # Identify label column
    label_col = "Label" if "Label" in raw.columns else raw.columns[-1]

    # Map labels to Providence taxonomy
    raw["providence_label"] = raw[label_col].str.strip().map(CICIDS_LABEL_MAP)
    # Fallback: catch any "Web Attack" variant that didn't match exact encoding
    web_attack_mask = raw[label_col].str.strip().str.startswith("Web Attack") & raw["providence_label"].isna()
    raw.loc[web_attack_mask, "providence_label"] = "INJECTION"
    unmapped = raw[raw["providence_label"].isna()][label_col].unique()
    if len(unmapped) > 0:
        logger.warning("Unmapped labels (dropped): %s", unmapped)
    raw = raw.dropna(subset=["providence_label"])

    # Extract intersection features only
    feature_df = pd.DataFrame()

    for cicids_col, prov_name in CICIDS_COLUMN_MAP.items():
        if cicids_col in raw.columns:
            feature_df[prov_name] = pd.to_numeric(raw[cicids_col], errors="coerce")
        else:
            logger.warning("CICIDS column '%s' not found, filling with 0", cicids_col)
            feature_df[prov_name] = 0

    # Derived features
    fwd = pd.to_numeric(raw.get("Total Fwd Packets", 0), errors="coerce").fillna(0)
    bwd = pd.to_numeric(raw.get("Total Backward Packets", 0), errors="coerce").fillna(0)
    feature_df["packet_count"] = fwd + bwd

    fwd_bytes = pd.to_numeric(raw.get("Total Length of Fwd Packets", 0), errors="coerce").fillna(0)
    bwd_bytes = pd.to_numeric(raw.get("Total Length of Bwd Packets", 0), errors="coerce").fillna(0)
    feature_df["total_bytes"] = fwd_bytes + bwd_bytes

    # Reorder to match INTERSECTION_FEATURES
    feature_df = feature_df[INTERSECTION_FEATURES]

    # Clean: replace Inf with NaN, drop rows with NaN
    feature_df = feature_df.replace([np.inf, -np.inf], np.nan)
    valid_mask = feature_df.notna().all(axis=1)
    feature_df = feature_df[valid_mask].reset_index(drop=True)
    labels = raw.loc[valid_mask.index[valid_mask], "providence_label"].reset_index(drop=True)

    # Print class distribution
    dist = labels.value_counts()
    logger.info("Class distribution:\n%s", dist.to_string())
    print(f"\nLoaded {len(feature_df)} samples, {len(INTERSECTION_FEATURES)} features")
    print(f"Class distribution:\n{dist.to_string()}\n")

    return feature_df, labels
