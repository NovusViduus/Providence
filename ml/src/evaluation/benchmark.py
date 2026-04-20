"""Inference latency benchmarks."""

import argparse
import logging
import time
import sys

import numpy as np

from src.models.model_registry import ModelRegistry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def benchmark(model_name: str, version: str = "v1") -> None:
    registry = ModelRegistry()
    model, preprocessor, feature_set = registry.load(model_name, version)

    n_features = len(preprocessor.feature_set)
    sample = np.random.randn(n_features)

    # Single-sample latency
    times = []
    for _ in range(1000):
        scaled = preprocessor.transform_array(sample)
        t0 = time.perf_counter()
        model.predict(scaled[0])
        times.append(time.perf_counter() - t0)

    median_us = np.median(times) * 1e6
    p99_us = np.percentile(times, 99) * 1e6

    print(f"\n=== Inference Benchmark: {model_name} ===")
    print(f"Single sample (1000 runs): median={median_us:.0f}µs  p99={p99_us:.0f}µs")

    # Batch inference
    for batch_size in [100, 1000, 10000]:
        batch = np.random.randn(batch_size, n_features)
        t0 = time.perf_counter()
        for i in range(batch_size):
            model.predict(batch[i])
        elapsed = time.perf_counter() - t0
        per_sample = elapsed / batch_size * 1e6
        print(f"Batch {batch_size:>6}: total={elapsed:.3f}s  per_sample={per_sample:.0f}µs")

    # Memory footprint
    size = sys.getsizeof(model)
    print(f"Model object size: {size} bytes")

    target_ms = 5.0
    if median_us / 1000 < target_ms:
        print(f"\n✓ Meets target: {median_us/1000:.2f}ms < {target_ms}ms")
    else:
        print(f"\n✗ Exceeds target: {median_us/1000:.2f}ms > {target_ms}ms")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    benchmark(args.model, args.version)


if __name__ == "__main__":
    main()
