# ML Pipeline — Classification Service

Traffic classification (CICIDS2017 baseline) + experimental AI agent detection (LSTM/CNN).

## Install

```bash
cd ml && pip install -e '.[test]'
```

## Train

```bash
python -m src.training.train_classifier --data-dir /path/to/cicids --feature-set intersection
python -m src.training.train_ai_detector --human-dir data/human --ai-dir data/ai_agent
```

## Evaluate

```bash
python -m src.evaluation.evaluate --model xgboost_intersection --data-dir /path/to/cicids
python -m src.evaluation.benchmark --model xgboost_intersection
```

## Inference Server

```bash
python -m src.server --socket-path /tmp/providence_ml.sock
python -m src.ai_detect_server --port 50052
```

## Documentation

- [Model Evaluation](docs/MODEL_EVALUATION.md)
- [AI Detection](docs/AI_DETECTION.md)
