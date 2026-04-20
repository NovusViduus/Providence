"""Load and combine HUMAN + AI_AGENT session data for AI detection training."""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from src.features.behavioral import AI_DETECTION_FEATURES, extract_features

logger = logging.getLogger(__name__)


def load_sessions(data_dir: str | Path, label: str) -> list[dict]:
    """Load session JSON files from a directory."""
    data_dir = Path(data_dir)
    sessions = []
    for f in sorted(data_dir.glob("*.json")):
        with open(f) as fh:
            session = json.load(fh)
            session["_label"] = label
            sessions.append(session)
    logger.info("Loaded %d %s sessions from %s", len(sessions), label, data_dir)
    return sessions


def build_dataset(human_dir: str | Path, ai_dir: str | Path) -> tuple[pd.DataFrame, pd.Series]:
    """Build labeled dataset from HUMAN and AI_AGENT session directories.

    Returns (X: DataFrame with AI_DETECTION_FEATURES columns, y: Series with labels).
    """
    human_sessions = load_sessions(human_dir, "HUMAN")
    ai_sessions = load_sessions(ai_dir, "AI_AGENT")
    all_sessions = human_sessions + ai_sessions

    if not all_sessions:
        return pd.DataFrame(columns=AI_DETECTION_FEATURES), pd.Series(dtype=str)

    rows = []
    labels = []
    for session in all_sessions:
        features = extract_features(session)
        rows.append([features.get(f, 0.0) for f in AI_DETECTION_FEATURES])
        labels.append(session["_label"])

    X = pd.DataFrame(rows, columns=AI_DETECTION_FEATURES)
    X = X.replace([np.inf, -np.inf], np.nan).fillna(0)
    y = pd.Series(labels)

    logger.info("Dataset: %d samples (%d HUMAN, %d AI_AGENT), %d features",
                len(X), sum(y == "HUMAN"), sum(y == "AI_AGENT"), len(AI_DETECTION_FEATURES))
    return X, y
