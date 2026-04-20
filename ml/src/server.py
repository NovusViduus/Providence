"""Unix domain socket inference server for Providence ML.

Wire protocol (matches The Eye's MlClient):
  1. Read 4-byte big-endian length prefix
  2. Read `length` bytes of serialized FeatureVector protobuf
  3. Classify and return Classification protobuf with same framing
"""

import argparse
import logging
import os
import signal
import socket
import struct
import sys

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Add proto stubs to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.models.model_registry import ModelRegistry
from src.features.schema import INTERSECTION_FEATURES, EYE_FULL_FEATURES, protobuf_to_array


class InferenceServer:
    def __init__(self, socket_path: str, models_dir: str | None = None):
        self.socket_path = socket_path
        self.sock = None
        self.running = False
        self.model = None
        self.preprocessor = None
        self.feature_set_name = None
        self.feature_set = None

        # Load model
        registry = ModelRegistry(models_dir)
        active = registry.get_active()
        model_name = active["model_name"]
        version = active.get("version", "v1")

        self.model, self.preprocessor, self.feature_set_name = registry.load(model_name, version)
        self.feature_set = EYE_FULL_FEATURES if self.feature_set_name == "full" else INTERSECTION_FEATURES

        logger.info("Loaded model: %s %s", model_name, version)
        logger.info("Feature set: %s (%d features)", self.feature_set_name, len(self.feature_set))
        logger.info("Socket path: %s", self.socket_path)

    def start(self):
        # Remove stale socket
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)

        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(self.socket_path)
        self.sock.listen(5)
        self.sock.settimeout(1.0)  # allow periodic shutdown check
        self.running = True

        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

        logger.info("Inference server listening on %s", self.socket_path)

        while self.running:
            try:
                conn, _ = self.sock.accept()
                self._handle_connection(conn)
            except socket.timeout:
                continue
            except OSError:
                if self.running:
                    raise
                break

        self._cleanup()

    def _handle_connection(self, conn: socket.socket):
        logger.info("Client connected")
        try:
            while self.running:
                # Read length prefix
                header = self._recv_exact(conn, 4)
                if header is None:
                    break
                msg_len = struct.unpack("!I", header)[0]
                if msg_len > 1024 * 1024:
                    logger.warning("Message too large: %d bytes", msg_len)
                    break

                # Read message
                data = self._recv_exact(conn, msg_len)
                if data is None:
                    break

                # Deserialize FeatureVector
                try:
                    from proto import features_pb2
                    fv = features_pb2.FeatureVector()
                    fv.ParseFromString(data)
                except Exception as e:
                    logger.error("Failed to parse FeatureVector: %s", e)
                    break

                # Extract features for active model's feature set
                features = protobuf_to_array(fv, self.feature_set)
                scaled = self.preprocessor.transform_array(features)

                # Predict
                category, confidence, importances = self.model.predict(scaled[0])
                logger.debug("Prediction: %s (%.3f)", category, confidence)

                # Build Classification response
                from proto import event_pb2
                classification = event_pb2.Classification()
                classification.category = category
                classification.subcategory = ""
                classification.confidence = confidence
                for k, v in list(importances.items())[:10]:
                    classification.feature_importances[k] = v

                # Send response
                response_data = classification.SerializeToString()
                conn.sendall(struct.pack("!I", len(response_data)))
                conn.sendall(response_data)

        except (ConnectionResetError, BrokenPipeError):
            logger.info("Client disconnected")
        except Exception as e:
            logger.error("Error handling connection: %s", e)
        finally:
            conn.close()

    def _recv_exact(self, conn: socket.socket, n: int) -> bytes | None:
        data = b""
        while len(data) < n:
            try:
                chunk = conn.recv(n - len(data))
            except socket.timeout:
                if not self.running:
                    return None
                continue
            if not chunk:
                return None
            data += chunk
        return data

    def _shutdown(self, signum, frame):
        logger.info("Shutting down...")
        self.running = False

    def _cleanup(self):
        if self.sock:
            self.sock.close()
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
        logger.info("Server stopped, socket removed")


def main():
    parser = argparse.ArgumentParser(description="Providence ML Inference Server")
    parser.add_argument("--socket-path", default="/tmp/providence_ml.sock")
    parser.add_argument("--models-dir", default=None)
    args = parser.parse_args()

    server = InferenceServer(args.socket_path, args.models_dir)
    server.start()


if __name__ == "__main__":
    main()
