"""Tests for AI detection models (CPU only, synthetic data)."""

import numpy as np
import torch
import pytest

from src.models.sequence_model import (
    AttackSequenceCNN, AttackSequenceLSTM, session_to_sequence, MAX_SEQ_LEN, EVENT_DIM,
)


class TestCNN:
    def test_forward_pass(self):
        model = AttackSequenceCNN(input_dim=EVENT_DIM)
        x = torch.randn(4, MAX_SEQ_LEN, EVENT_DIM)
        out = model(x)
        assert out.shape == (4,)
        assert (out >= 0).all() and (out <= 1).all()

    def test_single_sample(self):
        model = AttackSequenceCNN(input_dim=EVENT_DIM)
        x = torch.randn(1, MAX_SEQ_LEN, EVENT_DIM)
        out = model(x)
        assert out.shape == (1,)
        assert 0.0 <= out.item() <= 1.0

    def test_save_load(self, tmp_path):
        model = AttackSequenceCNN(input_dim=EVENT_DIM)
        path = tmp_path / "cnn.pt"
        torch.save(model.state_dict(), path)
        loaded = AttackSequenceCNN(input_dim=EVENT_DIM)
        loaded.load_state_dict(torch.load(path, weights_only=True))
        x = torch.randn(1, MAX_SEQ_LEN, EVENT_DIM)
        assert torch.allclose(model(x), loaded(x))


class TestLSTM:
    def test_forward_pass(self):
        model = AttackSequenceLSTM(input_dim=EVENT_DIM)
        x = torch.randn(4, MAX_SEQ_LEN, EVENT_DIM)
        out = model(x)
        assert out.shape == (4,)
        assert (out >= 0).all() and (out <= 1).all()

    def test_single_sample(self):
        model = AttackSequenceLSTM(input_dim=EVENT_DIM)
        x = torch.randn(1, MAX_SEQ_LEN, EVENT_DIM)
        out = model(x)
        assert 0.0 <= out.item() <= 1.0


class TestSessionToSequence:
    def test_output_shape(self):
        session = {
            "session_metadata": {
                "inter_attempt_ms": [2000, 2100, 1900],
                "attempts_in_session": 4,
                "commands_executed": [],
                "successes": [False, False, False, True],
            }
        }
        seq = session_to_sequence(session)
        assert seq.shape == (MAX_SEQ_LEN, EVENT_DIM)
        assert seq.dtype == np.float32

    def test_empty_session(self):
        session = {"session_metadata": {"inter_attempt_ms": [], "attempts_in_session": 0, "commands_executed": [], "successes": []}}
        seq = session_to_sequence(session)
        assert seq.shape == (MAX_SEQ_LEN, EVENT_DIM)
        assert np.all(seq == 0)

    def test_padding(self):
        session = {
            "session_metadata": {
                "inter_attempt_ms": [1000],
                "attempts_in_session": 2,
                "commands_executed": [],
                "successes": [False, False],
            }
        }
        seq = session_to_sequence(session)
        # First 2 rows should have data, rest should be zero-padded
        assert seq[2:].sum() == 0
