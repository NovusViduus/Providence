# Providence — Performance Benchmarks

> Run benchmarks on your hardware and fill in the numbers below.
> Methodology: each benchmark runs in isolation, results are median of 3 runs unless noted.

## The Eye (C++)

| Metric | Value | Methodology |
|---|---|---|
| `process_packet` throughput | ___ pkt/s | `eye/build/benchmarks/throughput_bench` — 100K synthetic packets |
| `parse_ja3` throughput | ___ parse/s | Same benchmark, TLS ClientHello payloads |
| `parse_dns_query` throughput | ___ parse/s | Same benchmark, DNS query payloads |
| Ring buffer push/pop | ___ ops/s | Concurrent SPSC test in `test_ring_buffer` |
| Estimated Mbps | ___ Mbps | packets × avg_size × 8 / elapsed |

## ML Service (Python)

| Metric | Value | Methodology |
|---|---|---|
| Single inference latency (median) | ___ µs | `python -m src.evaluation.benchmark --model xgboost_intersection` |
| Single inference latency (p99) | ___ µs | Same |
| Batch 1000 per-sample | ___ µs | Same |
| Model load time | ___ ms | Timed in server startup log |
| Memory footprint | ___ MB | `sys.getsizeof` (shallow) |

## The Citadel (Java)

| Metric | Value | Methodology |
|---|---|---|
| gRPC ingestion throughput | ___ events/s | `scripts/bench_citadel.sh` — grpcurl loop |
| REST GET /events latency (p50) | ___ ms | curl loop, 100 requests |
| REST GET /events latency (p99) | ___ ms | Same |
| WebSocket fan-out latency | ___ ms | Time from gRPC receive to WS broadcast |

## The Lens (React)

| Metric | Value | Methodology |
|---|---|---|
| Production build size | ___ KB | `npm run build` output |
| Time to interactive | ___ s | Lighthouse or manual measurement |
| Globe FPS at 100 markers | ___ fps | Chrome DevTools Performance tab |
| Globe FPS at 500 markers | ___ fps | Same |

## Hardware

| Property | Value |
|---|---|
| Machine | ___ |
| CPU | ___ |
| RAM | ___ |
| OS | ___ |
| Docker version | ___ |
