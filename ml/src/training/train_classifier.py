"""Train Providence classifiers.

Usage:
    python -m src.training.train_classifier --data-dir /path/to/cicids --feature-set intersection
    python -m src.training.train_classifier --data-dir /path/to/eye-data --feature-set full
"""

import argparse
import logging
import time
import sys
from pathlib import Path

import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, classification_report

from src.features.schema import INTERSECTION_FEATURES, EYE_FULL_FEATURES
from src.data.cicids_loader import load_cicids
from src.data.honeypot_loader import load_honeypot_raw, load_honeypot_eye_processed
from src.data.preprocessor import Preprocessor, combine_datasets
from src.models.random_forest import RandomForestModel
from src.models.gradient_boosted import XGBoostModel, LightGBMModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

SAVE_DIR = Path(__file__).parent.parent.parent / "models" / "saved"


def fmt_time(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(int(seconds), 60)
    return f"{m}m {s}s"


def progress(msg: str):
    """Print a timestamped progress message that's immediately visible."""
    ts = time.strftime("%H:%M:%S")
    print(f"\n{'='*60}", flush=True)
    print(f"  [{ts}] {msg}", flush=True)
    print(f"{'='*60}", flush=True)


def train_intersection(data_dir: str, honeypot_dir: str | None = None) -> None:
    """Train models on INTERSECTION_FEATURES using CICIDS + optional honeypot data."""
    pipeline_start = time.time()
    SAVE_DIR.mkdir(parents=True, exist_ok=True)

    # ── Step 1: Load data ──
    progress("STEP 1/6: Loading CICIDS data...")
    t0 = time.time()
    X_cicids, y_cicids = load_cicids(data_dir)
    print(f"  Loaded {len(X_cicids):,} samples in {fmt_time(time.time()-t0)}", flush=True)

    datasets = [(X_cicids, y_cicids, "cicids")]

    if honeypot_dir:
        progress("STEP 1b: Loading honeypot data...")
        t0 = time.time()
        X_hp, y_hp = load_honeypot_raw(honeypot_dir)
        if len(X_hp) > 0:
            datasets.append((X_hp, y_hp, "honeypot_raw"))
            print(f"  Loaded {len(X_hp):,} honeypot samples in {fmt_time(time.time()-t0)}", flush=True)

    X, y = combine_datasets(*datasets) if len(datasets) > 1 else (X_cicids, y_cicids)

    # ── Step 2: Preprocess ──
    progress("STEP 2/6: Preprocessing + train/test split...")
    t0 = time.time()
    pp = Preprocessor(feature_set_name="intersection")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    X_train_scaled = pp.fit_transform(X_train)
    X_test_scaled = pp.transform(X_test)
    pp.save(SAVE_DIR / "preprocessor_intersection_v1.joblib")
    print(f"  Train: {len(X_train):,} samples, Test: {len(X_test):,} samples", flush=True)
    print(f"  Preprocessing done in {fmt_time(time.time()-t0)}", flush=True)

    features = INTERSECTION_FEATURES

    # ── Step 3: Train Random Forest ──
    progress("STEP 3/6: Training Random Forest (200 trees, all cores)...")
    t0 = time.time()
    rf = RandomForestModel()
    rf.train(X_train_scaled, y_train.values, features)
    rf_time = time.time() - t0
    print(f"  Training done in {fmt_time(rf_time)}", flush=True)

    print("  Evaluating...", flush=True)
    preds = rf.model.predict(X_test_scaled)
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, average="macro")
    print(f"  ✓ Random Forest: accuracy={acc:.4f}  macro_f1={f1:.4f}", flush=True)
    rf.save(str(SAVE_DIR / "random_forest_intersection_v1.joblib"))
    print(f"  Saved to models/saved/", flush=True)

    # ── Step 4: Train XGBoost ──
    progress("STEP 4/6: Training XGBoost (300 rounds, early stopping)...")
    t0 = time.time()
    xgb_model = XGBoostModel()
    xgb_model.train(X_train_scaled, y_train.values, features)
    xgb_time = time.time() - t0
    print(f"  Training done in {fmt_time(xgb_time)}", flush=True)

    print("  Evaluating...", flush=True)
    import xgboost as xgb
    dm = xgb.DMatrix(X_test_scaled, feature_names=features)
    proba = xgb_model.model.predict(dm)
    preds = [xgb_model.classes[int(np.argmax(p))] for p in proba]
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, average="macro")
    print(f"  ✓ XGBoost: accuracy={acc:.4f}  macro_f1={f1:.4f}", flush=True)
    xgb_model.save(str(SAVE_DIR / "xgboost_intersection_v1.joblib"))
    print(f"  Saved to models/saved/", flush=True)

    # ── Step 5: Train LightGBM ──
    progress("STEP 5/6: Training LightGBM (300 rounds, early stopping)...")
    t0 = time.time()
    lgbm_model = LightGBMModel()
    lgbm_model.train(X_train_scaled, y_train.values, features)
    lgbm_time = time.time() - t0
    print(f"  Training done in {fmt_time(lgbm_time)}", flush=True)

    print("  Evaluating...", flush=True)
    proba = lgbm_model.model.predict(X_test_scaled)
    preds = [lgbm_model.classes[int(np.argmax(p))] for p in proba]
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, average="macro")
    print(f"  ✓ LightGBM: accuracy={acc:.4f}  macro_f1={f1:.4f}", flush=True)
    lgbm_model.save(str(SAVE_DIR / "lightgbm_intersection_v1.joblib"))
    print(f"  Saved to models/saved/", flush=True)

    # ── Step 6: Summary ──
    total = time.time() - pipeline_start
    progress(f"DONE — Total pipeline time: {fmt_time(total)}")
    print(f"  Random Forest: {fmt_time(rf_time)}", flush=True)
    print(f"  XGBoost:       {fmt_time(xgb_time)}", flush=True)
    print(f"  LightGBM:      {fmt_time(lgbm_time)}", flush=True)
    print(f"\n  Models saved to: {SAVE_DIR}/", flush=True)
    print(f"  Files:", flush=True)
    for f in sorted(SAVE_DIR.glob("*.joblib")):
        size_mb = f.stat().st_size / 1024 / 1024
        print(f"    {f.name} ({size_mb:.1f} MB)", flush=True)


def train_full(data_dir: str) -> None:
    """Train model on EYE_FULL_FEATURES using Eye-processed data."""
    SAVE_DIR.mkdir(parents=True, exist_ok=True)

    progress("Loading Eye-processed data...")
    X, y = load_honeypot_eye_processed(data_dir)
    if len(X) < 1000:
        print(f"  ⚠ Only {len(X)} samples (need ≥1000). Full-feature model deferred.", flush=True)
        return

    pp = Preprocessor(feature_set_name="full")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    X_train_scaled = pp.fit_transform(X_train)
    X_test_scaled = pp.transform(X_test)
    pp.save(SAVE_DIR / "preprocessor_full_v1.joblib")

    progress("Training XGBoost (full features)...")
    t0 = time.time()
    model = XGBoostModel()
    model.train(X_train_scaled, y_train.values, EYE_FULL_FEATURES)
    elapsed = time.time() - t0

    import xgboost as xgb
    dm = xgb.DMatrix(X_test_scaled, feature_names=EYE_FULL_FEATURES)
    proba = model.model.predict(dm)
    preds = [model.classes[int(np.argmax(p))] for p in proba]
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, average="macro")
    print(f"  ✓ XGBoost Full: accuracy={acc:.4f}  macro_f1={f1:.4f}  time={fmt_time(elapsed)}", flush=True)
    model.save(str(SAVE_DIR / "xgboost_full_v1.joblib"))


def main():
    parser = argparse.ArgumentParser(description="Train Providence classifiers")
    parser.add_argument("--data-dir", required=True, help="Path to training data")
    parser.add_argument("--honeypot-dir", default=None, help="Path to honeypot data")
    parser.add_argument("--feature-set", choices=["intersection", "full"], default="intersection")
    args = parser.parse_args()

    if args.feature_set == "intersection":
        train_intersection(args.data_dir, args.honeypot_dir)
    else:
        train_full(args.data_dir)


if __name__ == "__main__":
    main()
