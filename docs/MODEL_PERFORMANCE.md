# Providence — Model Performance Summary

> Detailed evaluation in [ml/docs/MODEL_EVALUATION.md](../ml/docs/MODEL_EVALUATION.md) and [ml/docs/AI_DETECTION.md](../ml/docs/AI_DETECTION.md).

## Flow Classification (CICIDS2017 Baseline)

Three models trained on `INTERSECTION_FEATURES` (16 features with clean CICIDS ↔ Eye semantic equivalence):

| Model | Feature Set | Training | Artifacts |
|---|---|---|---|
| Random Forest | Intersection (16) | 200 trees, balanced weights | `random_forest_intersection_v1.joblib` |
| XGBoost | Intersection (16) | 300 rounds, early stopping (patience 20) | `xgboost_intersection_v1.joblib` |
| LightGBM | Intersection (16) | 300 rounds, early stopping (patience 20) | `lightgbm_intersection_v1.joblib` |

Categories: BENIGN, DOS, PROBE, BRUTE_FORCE, INJECTION, EXFILTRATION

Run evaluation: `python -m src.evaluation.evaluate --model xgboost_intersection --data-dir /path/to/cicids`

## AI Agent Detection (Experimental)

Binary classifier: HUMAN vs AI_AGENT sessions using 24 behavioral features.

| Model | Architecture | Artifacts |
|---|---|---|
| XGBoost Baseline | Tabular (24 aggregate features) | `ai_detector_xgb_v1.joblib` |
| 1D CNN | Multi-kernel (3,5,7) convolutions over event sequences | `ai_detector_cnn_v1.pt` |
| LSTM | Bidirectional 2-layer, hidden_dim=64 | `ai_detector_lstm_v1.pt` |

Run evaluation: `python -m src.evaluation.evaluate_ai_detector --human-dir data/human --ai-dir data/ai_agent`

## Two-Model Strategy

- **Model A (CICIDS Baseline)**: Trains on intersection features only. No train/serve skew because both CICIDS and Eye compute these features identically.
- **Model B (Eye-Native)**: Trains on all 31 Eye features (entropy, JA3, window stats, inter-arrival). Deployed when ≥1000 Eye-processed labeled flows are collected.

## Key Limitations

1. CICIDS2017 data is from 2017 — modern attack patterns may differ
2. Intersection feature set uses 16 of 31 available features
3. AI agent detection is explicitly experimental — 9 documented limitations in AI_DETECTION.md
4. No AI_AGENT ground truth exists; model trained on synthetic LLM-generated data
5. Models not validated on live production traffic until e2e test

## Inference Latency

Target: < 5ms per single-sample prediction (within Eye's 500ms socket timeout).

Run benchmark: `python -m src.evaluation.benchmark --model xgboost_intersection`
