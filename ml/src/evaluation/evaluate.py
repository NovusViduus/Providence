"""Model evaluation — generates metrics, confusion matrices, and plots."""

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_curve,
    auc,
    accuracy_score,
    f1_score,
)
from sklearn.preprocessing import label_binarize

from src.models.model_registry import ModelRegistry
from src.data.cicids_loader import load_cicids
from src.features.schema import VALID_CATEGORIES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PLOTS_DIR = Path(__file__).parent.parent.parent / "evaluation" / "plots"
METRICS_DIR = Path(__file__).parent.parent.parent / "evaluation"


def evaluate_model(model_name: str, data_dir: str, version: str = "v1") -> None:
    """Run full evaluation on a trained model."""
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    METRICS_DIR.mkdir(parents=True, exist_ok=True)

    registry = ModelRegistry()
    model, preprocessor, feature_set = registry.load(model_name, version)

    X, y = load_cicids(data_dir)
    print(f"Evaluating {model_name} on {len(X):,} samples...", flush=True)
    X_scaled = preprocessor.transform(X)

    # Predictions — batch for all model types
    print("  Running predictions...", flush=True)
    import time as _time
    t0 = _time.time()

    if hasattr(model.model, 'predict_proba'):
        # sklearn RF — has both predict and predict_proba
        preds = model.model.predict(X_scaled)
        confs = [float(max(p)) for p in model.model.predict_proba(X_scaled)]
    elif 'xgboost' in model_name or 'xgb' in str(type(model.model)).lower():
        # XGBoost — use DMatrix batch predict
        import xgboost as xgb
        dm = xgb.DMatrix(X_scaled, feature_names=list(preprocessor.feature_set))
        proba = model.model.predict(dm)
        preds = np.array([model.classes[int(np.argmax(p))] for p in proba])
        confs = [float(max(p)) for p in proba]
    else:
        # LightGBM — batch predict returns probabilities
        proba = model.model.predict(X_scaled)
        preds = np.array([model.classes[int(np.argmax(p))] for p in proba])
        confs = [float(max(p)) for p in proba]

    print(f"  Predictions done in {_time.time()-t0:.1f}s", flush=True)

    preds = np.array(preds)
    acc = accuracy_score(y, preds)
    f1_macro = f1_score(y, preds, average="macro")
    f1_weighted = f1_score(y, preds, average="weighted")

    report = classification_report(y, preds, output_dict=True)
    print(classification_report(y, preds))

    # Initialize metrics dict
    metrics = {
        "model": model_name,
        "version": version,
        "feature_set": feature_set,
        "accuracy": acc,
        "f1_macro": f1_macro,
        "f1_weighted": f1_weighted,
        "per_category": report,
    }

    # Confusion matrix
    labels = sorted(y.unique())
    cm = confusion_matrix(y, preds, labels=labels)
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))
    sns.heatmap(cm, annot=True, fmt="d", xticklabels=labels, yticklabels=labels, ax=ax1, cmap="Blues")
    ax1.set_title(f"{model_name} — Confusion Matrix (counts)")
    ax1.set_ylabel("True")
    ax1.set_xlabel("Predicted")

    sns.heatmap(cm_norm, annot=True, fmt=".2f", xticklabels=labels, yticklabels=labels, ax=ax2, cmap="Blues")
    ax2.set_title(f"{model_name} — Confusion Matrix (normalized)")
    ax2.set_ylabel("True")
    ax2.set_xlabel("Predicted")

    plt.tight_layout()
    plt.savefig(PLOTS_DIR / f"{model_name}_confusion_matrix.png", dpi=150)
    plt.close()

    # ROC curves (one-vs-rest)
    y_bin = label_binarize(y, classes=labels)
    n_classes = len(labels)

    # Get probability scores for ROC curves
    print("  Computing ROC curves...", flush=True)
    if hasattr(model.model, 'predict_proba'):
        all_proba = model.model.predict_proba(X_scaled)
    elif 'xgboost' in model_name or 'xgb' in str(type(model.model)).lower():
        import xgboost as xgb
        dm = xgb.DMatrix(X_scaled, feature_names=list(preprocessor.feature_set))
        all_proba = model.model.predict(dm)
    else:
        all_proba = model.model.predict(X_scaled)

    if all_proba.any():
        fig, ax = plt.subplots(figsize=(10, 8))
        roc_aucs = {}
        for idx, label in enumerate(labels):
            if y_bin[:, idx].sum() == 0:
                continue
            fpr, tpr, _ = roc_curve(y_bin[:, idx], all_proba[:, idx])
            roc_auc = auc(fpr, tpr)
            roc_aucs[label] = roc_auc
            ax.plot(fpr, tpr, label=f"{label} (AUC={roc_auc:.3f})")

        ax.plot([0, 1], [0, 1], "k--", alpha=0.3)
        ax.set_xlabel("False Positive Rate")
        ax.set_ylabel("True Positive Rate")
        ax.set_title(f"{model_name} — ROC Curves (One-vs-Rest)")
        ax.legend(loc="lower right")
        plt.tight_layout()
        plt.savefig(PLOTS_DIR / f"{model_name}_roc_curves.png", dpi=150)
        plt.close()

        metrics["roc_auc_per_category"] = roc_aucs

    # Feature importances
    _, _, importances = model.predict(X_scaled[0])
    if importances:
        fig, ax = plt.subplots(figsize=(10, 6))
        sorted_imp = sorted(importances.items(), key=lambda x: x[1], reverse=True)
        names, values = zip(*sorted_imp)
        ax.barh(range(len(names)), values)
        ax.set_yticks(range(len(names)))
        ax.set_yticklabels(names)
        ax.set_title(f"{model_name} — Feature Importances (top {len(names)})")
        ax.invert_yaxis()
        plt.tight_layout()
        plt.savefig(PLOTS_DIR / f"{model_name}_feature_importances.png", dpi=150)
        plt.close()

    # Save metrics
    with open(METRICS_DIR / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2, default=str)

    logger.info("Evaluation complete: accuracy=%.4f f1_macro=%.4f", acc, f1_macro)
    logger.info("Plots saved to %s", PLOTS_DIR)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Model name (e.g., xgboost_intersection)")
    parser.add_argument("--data-dir", required=True, help="Path to CICIDS data")
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    evaluate_model(args.model, args.data_dir, args.version)


if __name__ == "__main__":
    main()
