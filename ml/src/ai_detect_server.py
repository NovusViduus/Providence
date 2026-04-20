"""HTTP endpoint for AI_AGENT session-level detection.

Runs alongside the Unix socket flow classifier.
POST /ml/ai-detect accepts session behavioral features, returns classification.
"""

import argparse
import json
import logging
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

import numpy as np

from src.features.behavioral import AI_DETECTION_FEATURES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parent.parent / "models" / "saved"
_model = None
_model_name = "unknown"


def load_model():
    global _model, _model_name
    # Try XGBoost baseline first (most reliable)
    xgb_path = MODELS_DIR / "ai_detector_xgb_v1.joblib"
    if xgb_path.exists():
        from src.models.gradient_boosted import XGBoostModel
        _model = XGBoostModel.load(str(xgb_path))
        _model_name = "ai_detector_xgb_v1"
        logger.info("Loaded AI detector: %s", _model_name)
        return

    # Try PyTorch CNN
    cnn_path = MODELS_DIR / "ai_detector_cnn_v1.pt"
    if cnn_path.exists():
        import torch
        from src.models.sequence_model import AttackSequenceCNN
        model = AttackSequenceCNN()
        model.load_state_dict(torch.load(cnn_path, weights_only=True))
        model.eval()
        _model = model
        _model_name = "ai_detector_cnn_v1"
        logger.info("Loaded AI detector: %s", _model_name)
        return

    logger.warning("No AI detector model found in %s", MODELS_DIR)


class AiDetectHandler(BaseHTTPRequestHandler):
    _start_time = time.time()

    def do_GET(self):
        if self.path == "/health":
            uptime = int(time.time() - AiDetectHandler._start_time)
            self._respond(200, {"status": "ok", "model": _model_name, "uptime": uptime})
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/ml/ai-detect":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        features = body.get("features", {})

        if _model is None:
            self._respond(503, {"error": "No model loaded"})
            return

        try:
            arr = np.array([features.get(f, 0.0) for f in AI_DETECTION_FEATURES], dtype=np.float64)
            category, confidence, _ = _model.predict(arr)
            is_ai = category == "AI_AGENT" or (isinstance(confidence, float) and confidence > 0.5)
            self._respond(200, {
                "isAiAgent": is_ai,
                "confidence": round(float(confidence), 4),
                "model": _model_name,
            })
        except Exception as e:
            logger.error("Prediction error: %s", e)
            self._respond(500, {"error": str(e)})

    def _respond(self, code: int, data: dict):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        logger.debug(format, *args)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=50052)
    args = parser.parse_args()

    load_model()
    server = HTTPServer(("0.0.0.0", args.port), AiDetectHandler)
    logger.info("AI detection HTTP server on port %d", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
