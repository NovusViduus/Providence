"""Sequence models for AI_AGENT detection.

FOR DEFENSIVE RESEARCH ONLY.

Model A: 1D CNN — multi-kernel convolutions over event sequences
Model B: LSTM — bidirectional LSTM over event sequences
Model C: XGBoost tabular baseline (in gradient_boosted.py)
"""

import numpy as np
import torch
import torch.nn as nn


MAX_SEQ_LEN = 50
EVENT_DIM = 3  # inter_time_ms, event_type (0=auth, 1=cmd, 2=download), success (0/1)


class AttackSequenceCNN(nn.Module):
    """Multi-kernel 1D CNN for temporal pattern detection."""

    def __init__(self, input_dim: int = EVENT_DIM, num_filters: int = 64,
                 kernel_sizes: list[int] | None = None):
        super().__init__()
        kernel_sizes = kernel_sizes or [3, 5, 7]
        self.convs = nn.ModuleList([
            nn.Conv1d(input_dim, num_filters, k, padding=k // 2)
            for k in kernel_sizes
        ])
        self.fc = nn.Sequential(
            nn.Linear(num_filters * len(kernel_sizes), 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, input_dim) → transpose to (batch, input_dim, seq_len)
        x = x.transpose(1, 2)
        pooled = []
        for conv in self.convs:
            c = torch.relu(conv(x))
            p = torch.max(c, dim=2).values  # global max pool
            pooled.append(p)
        x = torch.cat(pooled, dim=1)
        return self.fc(x).squeeze(-1)


class AttackSequenceLSTM(nn.Module):
    """Bidirectional LSTM for sequential dependency detection."""

    def __init__(self, input_dim: int = EVENT_DIM, hidden_dim: int = 64,
                 num_layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, num_layers,
                            batch_first=True, bidirectional=True, dropout=dropout)
        self.fc = nn.Sequential(
            nn.Linear(hidden_dim * 2, 64),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, input_dim)
        _, (h, _) = self.lstm(x)
        # Concatenate final hidden states from both directions
        h = torch.cat([h[-2], h[-1]], dim=1)
        return self.fc(h).squeeze(-1)


def session_to_sequence(session: dict, max_len: int = MAX_SEQ_LEN) -> np.ndarray:
    """Convert a session JSON to a padded sequence array.

    Each timestep: [inter_time_ms_normalized, event_type, success]
    """
    meta = session.get("session_metadata", {})
    inter_ms = meta.get("inter_attempt_ms", [])
    commands = meta.get("commands_executed", [])
    successes = meta.get("successes", [])
    attempts = meta.get("attempts_in_session", 0)

    events = []
    for i in range(attempts):
        t = inter_ms[i] / 10000.0 if i < len(inter_ms) else 0.0  # normalize to ~0-1 range
        etype = 1.0 if i < len(commands) and commands else 0.0  # 0=auth, 1=command
        success = float(successes[i]) if i < len(successes) else 0.0
        events.append([t, etype, success])

    # Pad or truncate
    seq = np.zeros((max_len, EVENT_DIM), dtype=np.float32)
    n = min(len(events), max_len)
    if n > 0:
        seq[:n] = events[:n]
    return seq
