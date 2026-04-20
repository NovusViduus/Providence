# The Eye — C++ Packet Capture Agent

Real-time network packet capture with flow tracking, TLS/JA3 fingerprinting, DNS parsing, and Shannon entropy analysis. Feeds classified events to The Citadel via gRPC.

## Build

```bash
cd eye
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
```

## Run

```bash
./build/eye en0                          # macOS default interface
./build/eye eth0 --citadel localhost:50051 --ml-socket /tmp/providence_ml.sock
```

## Test

```bash
cd build && ctest --output-on-failure
```

## Features Extracted (31 per flow)

Packet/byte counts, 6 TCP flags, directional splits, window sizes, payload entropy, JA3 hash, inter-arrival timing, TTL, and derived rates.
