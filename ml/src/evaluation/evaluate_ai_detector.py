"""Evaluation for AI_AGENT detection models.

Evaluates all three models (XGBoost, CNN, LSTM) side-by-side to answer:
"Does the temporal sequence add value over aggregate stats?"
"""

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import (
    classification_report, confusion_matrix, roc_curve, auc,
    precision_recall_curve, average_precision_score,
    accuracy_score, f1_score, roc_auc_score,
)
from sklearn.model_selection import train_test_split

from src.data.synthetic_loader import build_dataset, load_sessions
from src.features.behavioral import AI_DETECTION_FEATURES
from src.models.sequence_model import (
    AttackSequenceCNN, AttackSequenceLSTM, session_to_sequence, MAX_SEQ_LEN, EVENT_DIM,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parent.parent.parent / "models" / "saved"
PLOTS_DIR = Path(__file__).parent.parent.parent / "evaluation" / "plots" / "ai_detection"


def evaluate(human_dir: str, ai_dir: str):
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)

    # Load tabular features
    X, y = build_dataset(human_dir, ai_dir)
    y_bin = (y == "AI_AGENT").astype(int)
    X_train, X_test, y_train, y_test = train_test_split(
        X.values, y_bin.values, test_size=0.2, stratify=y_bin, random_state=42)

    # Load raw sessions for sequence models
    human_sessions = load_sessions(human_dir, "HUMAN")
    ai_sessions = load_sessions(ai_dir, "AI_AGENT")
    all_sessions = human_sessions + ai_sessions
    all_labels = [0] * len(human_sessions) + [1] * len(ai_sessions)
    sess_train, sess_test, slab_train, slab_test = train_test_split(
        all_sessions, all_labels, test_size=0.2, stratify=all_labels, random_state=42)

    results = {}
    roc_data = {}   # name → (fpr, tpr, auc)
    pr_data = {}    # name → (precision, recall, ap)

    # --- XGBoost baseline ---
    try:
        from src.models.gradient_boosted import XGBoostModel
        xgb_path = MODELS_DIR / "ai_detector_xgb_v1.joblib"
        if xgb_path.exists():
            model = XGBoostModel.load(str(xgb_path))
            preds = np.array([1 if model.predict(X_test[i])[0] == "AI_AGENT" else 0 for i in range(len(X_test))])
            # Get probability scores for ROC/PR
            scores = np.array([model.predict(X_test[i])[1] for i in range(len(X_test))])
            results["XGBoost"] = _compute_metrics("XGBoost Baseline", y_test, preds)
            roc_data["XGBoost"] = _compute_roc(y_test, scores)
            pr_data["XGBoost"] = _compute_pr(y_test, scores)

            # Feature importance for tabular baseline
            _, _, importances = model.predict(X_test[0])
            if importances:
                from src.features.behavioral import AI_DETECTION_FEATURES
                fig, ax = plt.subplots(figsize=(10, 8))
                sorted_imp = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:15]
                names, values = zip(*sorted_imp)
                ax.barh(range(len(names)), values, color='#00ffc8')
                ax.set_yticks(range(len(names)))
                ax.set_yticklabels(names)
                ax.set_title("XGBoost Baseline — Feature Importances (AI Detection)")
                ax.invert_yaxis()
                plt.tight_layout()
                plt.savefig(PLOTS_DIR / "xgboost_feature_importances.png", dpi=150)
                plt.close()
                results["XGBoost"]["top_features"] = dict(sorted_imp)
    except Exception as e:
        logger.warning("XGBoost eval failed: %s", e)

    # --- 1D CNN ---
    try:
        import torch
        cnn_path = MODELS_DIR / "ai_detector_cnn_v1.pt"
        if cnn_path.exists():
            model = AttackSequenceCNN(input_dim=EVENT_DIM)
            model.load_state_dict(torch.load(cnn_path, weights_only=True))
            model.eval()
            X_seq_test = np.array([session_to_sequence(s) for s in sess_test])
            with torch.no_grad():
                scores = model(torch.FloatTensor(X_seq_test)).numpy()
            preds = (scores > 0.5).astype(int)
            slab_arr = np.array(slab_test)
            results["CNN"] = _compute_metrics("1D CNN", slab_arr, preds)
            roc_data["CNN"] = _compute_roc(slab_arr, scores)
            pr_data["CNN"] = _compute_pr(slab_arr, scores)
    except Exception as e:
        logger.warning("CNN eval failed: %s", e)

    # --- LSTM ---
    try:
        import torch
        lstm_path = MODELS_DIR / "ai_detector_lstm_v1.pt"
        if lstm_path.exists():
            model = AttackSequenceLSTM(input_dim=EVENT_DIM)
            model.load_state_dict(torch.load(lstm_path, weights_only=True))
            model.eval()
            X_seq_test = np.array([session_to_sequence(s) for s in sess_test])
            with torch.no_grad():
                scores = model(torch.FloatTensor(X_seq_test)).numpy()
            preds = (scores > 0.5).astype(int)
            slab_arr = np.array(slab_test)
            results["LSTM"] = _compute_metrics("LSTM", slab_arr, preds)
            roc_data["LSTM"] = _compute_roc(slab_arr, scores)
            pr_data["LSTM"] = _compute_pr(slab_arr, scores)
    except Exception as e:
        logger.warning("LSTM eval failed: %s", e)

    # --- Comparison plots ---
    if roc_data:
        _plot_roc_overlay(roc_data)
    if pr_data:
        _plot_pr_overlay(pr_data)
    if results:
        _print_comparison_table(results)

    # Save results
    metrics_path = PLOTS_DIR.parent / "ai_detection_metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    logger.info("All metrics saved to %s", metrics_path)


def _compute_metrics(name: str, y_true, y_pred) -> dict:
    acc = accuracy_score(y_true, y_pred)
    f1 = f1_score(y_true, y_pred)
    report = classification_report(y_true, y_pred, target_names=["HUMAN", "AI_AGENT"], output_dict=True)
    print(f"\n=== {name} ===")
    print(classification_report(y_true, y_pred, target_names=["HUMAN", "AI_AGENT"]))

    cm = confusion_matrix(y_true, y_pred)
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.imshow(cm, cmap="Blues")
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=16)
    ax.set_xticks([0, 1]); ax.set_yticks([0, 1])
    ax.set_xticklabels(["HUMAN", "AI_AGENT"]); ax.set_yticklabels(["HUMAN", "AI_AGENT"])
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title(f"{name} — Confusion Matrix")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / f"{name.lower().replace(' ', '_')}_confusion.png", dpi=150)
    plt.close()

    return {"accuracy": acc, "f1": f1, "report": report}


def _compute_roc(y_true, scores) -> tuple:
    fpr, tpr, _ = roc_curve(y_true, scores)
    roc_auc = auc(fpr, tpr)
    return fpr, tpr, roc_auc


def _compute_pr(y_true, scores) -> tuple:
    precision, recall, _ = precision_recall_curve(y_true, scores)
    ap = average_precision_score(y_true, scores)
    return precision, recall, ap


def _plot_roc_overlay(roc_data: dict):
    fig, ax = plt.subplots(figsize=(8, 6))
    colors = {"XGBoost": "#ff6d00", "CNN": "#2979ff", "LSTM": "#00e5ff"}
    for name, (fpr, tpr, roc_auc) in roc_data.items():
        ax.plot(fpr, tpr, label=f"{name} (AUC={roc_auc:.3f})", color=colors.get(name, "#888"))
    ax.plot([0, 1], [0, 1], "k--", alpha=0.3)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("AI Agent Detection — ROC Curves")
    ax.legend(loc="lower right")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "roc_curves_comparison.png", dpi=150)
    plt.close()
    logger.info("ROC curves saved")


def _plot_pr_overlay(pr_data: dict):
    fig, ax = plt.subplots(figsize=(8, 6))
    colors = {"XGBoost": "#ff6d00", "CNN": "#2979ff", "LSTM": "#00e5ff"}
    for name, (precision, recall, ap) in pr_data.items():
        ax.plot(recall, precision, label=f"{name} (AP={ap:.3f})", color=colors.get(name, "#888"))
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title("AI Agent Detection — Precision-Recall Curves")
    ax.legend(loc="lower left")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "precision_recall_comparison.png", dpi=150)
    plt.close()
    logger.info("Precision-recall curves saved")


def _print_comparison_table(results: dict):
    print("\n" + "=" * 60)
    print(f"{'Model':<20} {'Accuracy':>10} {'F1':>10}")
    print("-" * 60)
    for name, metrics in results.items():
        print(f"{name:<20} {metrics['accuracy']:>10.4f} {metrics['f1']:>10.4f}")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--human-dir", required=True)
    parser.add_argument("--ai-dir", required=True)
    args = parser.parse_args()
    evaluate(args.human_dir, args.ai_dir)


if __name__ == "__main__":
    main()
