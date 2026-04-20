"""Train AI_AGENT detection models.

Usage:
    python -m src.training.train_ai_detector --human-dir data/human --ai-dir data/ai_agent
"""

import argparse
import logging
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from torch.utils.data import DataLoader, TensorDataset

from src.data.synthetic_loader import build_dataset, load_sessions
from src.features.behavioral import AI_DETECTION_FEATURES
from src.models.sequence_model import (
    AttackSequenceCNN, AttackSequenceLSTM, session_to_sequence, MAX_SEQ_LEN, EVENT_DIM,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SAVE_DIR = Path(__file__).parent.parent.parent / "models" / "saved"


def train_tabular(X_train, y_train, X_test, y_test):
    """Train XGBoost tabular baseline."""
    from src.models.gradient_boosted import XGBoostModel
    model = XGBoostModel()
    model.train(X_train, y_train, AI_DETECTION_FEATURES)

    preds = [model.predict(X_test[i])[0] for i in range(len(X_test))]
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, pos_label="AI_AGENT")
    logger.info("XGBoost baseline: accuracy=%.4f f1=%.4f", acc, f1)

    model.save(str(SAVE_DIR / "ai_detector_xgb_v1.joblib"))
    return acc, f1


def train_sequence_model(model_class, model_name, sessions_train, labels_train,
                         sessions_test, labels_test, epochs=50, lr=1e-3):
    """Train a PyTorch sequence model."""
    # Convert sessions to sequences
    X_train = np.array([session_to_sequence(s) for s in sessions_train])
    X_test = np.array([session_to_sequence(s) for s in sessions_test])
    y_train = np.array([1.0 if l == "AI_AGENT" else 0.0 for l in labels_train])
    y_test = np.array([1.0 if l == "AI_AGENT" else 0.0 for l in labels_test])

    train_ds = TensorDataset(torch.FloatTensor(X_train), torch.FloatTensor(y_train))
    train_dl = DataLoader(train_ds, batch_size=32, shuffle=True)

    model = model_class(input_dim=EVENT_DIM)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5)
    criterion = nn.BCELoss()

    best_loss = float("inf")
    patience_counter = 0

    for epoch in range(epochs):
        model.train()
        total_loss = 0
        for xb, yb in train_dl:
            optimizer.zero_grad()
            pred = model(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        avg_loss = total_loss / len(train_dl)
        scheduler.step(avg_loss)

        if avg_loss < best_loss:
            best_loss = avg_loss
            patience_counter = 0
            torch.save(model.state_dict(), str(SAVE_DIR / f"{model_name}.pt"))
        else:
            patience_counter += 1
            if patience_counter >= 10:
                logger.info("Early stopping at epoch %d", epoch)
                break

        if epoch % 10 == 0:
            logger.info("Epoch %d: loss=%.4f", epoch, avg_loss)

    # Evaluate
    model.eval()
    with torch.no_grad():
        preds = model(torch.FloatTensor(X_test)).numpy()
    pred_labels = (preds > 0.5).astype(int)
    acc = accuracy_score(y_test, pred_labels)
    f1 = f1_score(y_test, pred_labels)
    try:
        auc = roc_auc_score(y_test, preds)
    except ValueError:
        auc = 0.0
    logger.info("%s: accuracy=%.4f f1=%.4f auc=%.4f", model_name, acc, f1, auc)
    return acc, f1, auc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--human-dir", required=True)
    parser.add_argument("--ai-dir", required=True)
    parser.add_argument("--epochs", type=int, default=50)
    args = parser.parse_args()

    SAVE_DIR.mkdir(parents=True, exist_ok=True)

    # Load tabular features
    X, y = build_dataset(args.human_dir, args.ai_dir)
    X_train, X_test, y_train, y_test = train_test_split(
        X.values, y.values, test_size=0.2, stratify=y, random_state=42)

    logger.info("Training tabular baseline...")
    train_tabular(X_train, y_train, X_test, y_test)

    # Load raw sessions for sequence models
    human_sessions = load_sessions(args.human_dir, "HUMAN")
    ai_sessions = load_sessions(args.ai_dir, "AI_AGENT")
    all_sessions = human_sessions + ai_sessions
    all_labels = ["HUMAN"] * len(human_sessions) + ["AI_AGENT"] * len(ai_sessions)

    sess_train, sess_test, lab_train, lab_test = train_test_split(
        all_sessions, all_labels, test_size=0.2, stratify=all_labels, random_state=42)

    logger.info("Training 1D CNN...")
    train_sequence_model(AttackSequenceCNN, "ai_detector_cnn_v1",
                         sess_train, lab_train, sess_test, lab_test, epochs=args.epochs)

    logger.info("Training LSTM...")
    train_sequence_model(AttackSequenceLSTM, "ai_detector_lstm_v1",
                         sess_train, lab_train, sess_test, lab_test, epochs=args.epochs)

    logger.info("All models saved to %s", SAVE_DIR)


if __name__ == "__main__":
    main()
