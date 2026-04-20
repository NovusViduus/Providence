# The Eye — Comprehensive Status Document

> Providence Network Security Intelligence Platform  
> Component: The Eye — C++ Local Packet Capture Agent  
> Status as of: Phase 1 Complete

---

## 1. What The Eye Is

The Eye is the local network sensor for the Providence platform. It captures packets from a live network interface using libpcap, extracts a rich set of features from TCP flows and DNS queries, and exports them for downstream consumption by an ML inference service and a centralized backend (The Citadel). It is written in C++17 with no external dependencies beyond libpcap, OpenSSL, protobuf, and optionally gRPC.

---

## 2. Architecture

The Eye uses a producer-consumer architecture with a lock-free ring buffer decoupling capture from processing:

```
┌──────────────┐     ┌─────────────┐     ┌─────────────────┐
│  pcap_loop   │────▶│ Ring Buffer │────▶│   Processor     │
│  (capture    │     │ (SPSC,      │     │   (worker       │
│   thread)    │     │  lock-free) │     │    thread)      │
└──────────────┘     └─────────────┘     └────────┬────────┘
                                                   │
                                    ┌──────────────┼──────────────┐
                                    ▼              ▼              ▼
                              ┌──────────┐  ┌───────────┐  ┌───────────┐
                              │  Flow    │  │  TLS/JA3  │  │   DNS     │
                              │  Tracker │  │  Parser   │  │  Parser   │
                              └──────────┘  └───────────┘  └───────────┘
                                    │
                         ┌──────────┼──────────┐
                         ▼                     ▼
                   ┌───────────┐        ┌─────────────┐
                   │ ML Client │        │    gRPC     │
                   │ (Unix     │        │ Dispatcher  │
                   │  socket)  │        │ (Citadel)   │
                   └───────────┘        └─────────────┘
```

The capture callback is intentionally thin — it copies the raw packet into the ring buffer and returns. All parsing, feature extraction, and I/O happen on the worker thread.

---

## 3. Directory Structure

```
proto/
├── features.proto          # FeatureVector message (40 fields)
├── event.proto             # ClassifiedEvent, Classification, EventService gRPC
└── response.proto          # ResponseAction message

eye/
├── CMakeLists.txt          # Build system (replaces Makefile)
├── Dockerfile              # Multi-stage Ubuntu 24.04 container
├── src/
│   ├── main.cpp            # Entry point, arg parsing, thread orchestration
│   ├── processor.h/.cpp    # Worker thread: drains ring buffer, routes by protocol
│   ├── capture/
│   │   ├── ring_buffer.h   # Header-only SPSC lock-free ring buffer
│   │   ├── packet_capture.h
│   │   └── packet_capture.cpp  # pcap lifecycle, BPF filter, link-layer detection
│   ├── features/
│   │   ├── entropy.h       # Header-only Shannon entropy calculator
│   │   ├── feature_extractor.h  # FeatureVector struct (C++ side)
│   │   ├── flow_tracker.h/.cpp  # FlowStats, flow keying, parsing, JSON export
│   │   ├── tls_parser.h/.cpp    # TLS ClientHello → JA3 fingerprint
│   │   └── dns_parser.h/.cpp    # DNS query parsing
│   ├── bridge/
│   │   ├── ml_client.h/.cpp     # Unix domain socket client for ML service
│   └── dispatcher/
│       ├── grpc_dispatcher.h/.cpp  # gRPC client for The Citadel
├── tests/
│   ├── CMakeLists.txt
│   ├── test_ring_buffer.cpp
│   ├── test_entropy.cpp
│   ├── test_tls_parser.cpp
│   ├── test_dns_parser.cpp
│   ├── test_flow_tracker.cpp
│   └── mock_ml_server.py
└── benchmarks/
    ├── CMakeLists.txt
    └── throughput_bench.cpp
```

---

## 4. Packet Capture Layer

### Interface Selection
- Configurable via CLI argument: `./eye eth0` or `./eye en0`
- Defaults to `en0` (macOS convention); Dockerfile defaults to `eth0` (Linux)

### Link-Layer Detection
- Checks `pcap_datalink()` after opening the handle
- Supports `DLT_EN10MB` (Ethernet, 14-byte header) and `DLT_NULL`/`DLT_LOOP` (loopback, 4-byte header)
- Rejects unsupported link types with an error message

### BPF Filter
- `"tcp or udp port 53"` — captures all TCP traffic plus DNS queries over UDP
- Both `pcap_compile` and `pcap_setfilter` return values are checked; failures are fatal with cleanup

### Signal Handling
- `SIGINT` → `pcap_breakloop()` on the capture handle
- Clean shutdown: capture stops, worker thread drains remaining packets, then export and summary run

### Ring Buffer
- Header-only, template class with configurable capacity (default 4096 slots)
- Each slot: 65536-byte data array + uint32 length + long timestamp
- SPSC (single-producer, single-consumer) lock-free design using `std::atomic` head/tail indices
- Cache-line aligned (64-byte) atomic indices to prevent false sharing
- Slots are heap-allocated via `std::make_unique<PacketSlot[]>` to avoid stack overflow (~256MB at default capacity)
- `try_push` / `try_pop` semantics — never blocks, returns false if full/empty
- Known tradeoff: `try_pop` does a full 65KB copy per packet; a pointer/index return would be faster but adds complexity

---

## 5. Packet Parsing

### IP Header
- IHL field parsed dynamically: `(pkt[offset] & 0x0F) * 4` — handles IP options correctly
- TTL extracted from offset+8 (stored per-flow from first packet)
- Source/destination IPs extracted from offsets 12–19 relative to link-layer header end
- All byte values cast to `uint8_t` before formatting to prevent signed-char platform bugs

### TCP Header
- Offset computed as `link_hdr_len + IHL` — not hardcoded
- Ports extracted with explicit `uint8_t` casts to prevent sign extension: `(uint16_t)((uint8_t)pkt[off] << 8) | (uint8_t)pkt[off+1]`
- TCP data offset parsed from byte 12 upper nibble to find payload start
- Flags parsed from byte 13: SYN (0x02), ACK (0x10), FIN (0x01), RST (0x04), PSH (0x08), URG (0x20)
- Window size from bytes 14–15

### Protocol Routing
- Processor checks IP protocol field (offset `link_hdr_len + 9`)
- Protocol 6 (TCP) → `process_packet()`
- Protocol 17 (UDP) → `process_dns_packet()`

---

## 6. Flow Tracking

### Flow Key Construction
- Bidirectional: `side_a = ip:port`, `side_b = ip:port`, lexicographically ordered
- Format: `"10.0.0.1:443 <-> 192.168.1.5:54321"`
- Both directions of a conversation merge into one flow record

### FlowStats Fields
All state is file-local (`static`) in `flow_tracker.cpp` — no globals cross translation units.

| Category | Fields |
|---|---|
| Counts | `packet_count`, `total_bytes` |
| Flags | `syn_count`, `ack_count`, `fin_count`, `rst_count`, `psh_count`, `urg_count` |
| Direction | `fwd_side`, `packet_count_fwd`, `packet_count_bwd`, `bytes_fwd`, `bytes_bwd` |
| Timing | `first_seen` (`std::optional<long>`), `last_seen`, `timestamps` (vector for inter-arrival) |
| Window | `window_size_min`, `window_size_max`, `window_size_sum` |
| Payload | `entropy_sum`, `entropy_count`, `payload_size_min/max/sum`, `payload_count`, `zero_payload_count` |
| Network | `ttl` (from first packet) |
| TLS | `ja3_hash`, `ja3_seen`, `cipher_suite_count`, `extension_count` |

### Directional Tracking
- "Forward" is defined as the direction of the first packet seen on the flow
- `fwd_side` stores which `ip:port` string appeared first
- Each subsequent packet is classified as forward or backward by comparing against `fwd_side`

### Timing
- `first_seen` uses `std::optional<long>` instead of a magic-value sentinel
- Duration computed as `first_seen.has_value() ? last_seen - first_seen.value() : 0`
- All per-packet timestamps stored in a vector for inter-arrival statistics (mean, stddev, min, max)

### Data Structures
- `std::unordered_map<std::string, FlowStats>` — O(1) average lookup
- DNS stats tracked separately in `std::unordered_map<std::string, DnsStats>` keyed by source IP

---

## 7. Feature Extraction

### Shannon Entropy (`entropy.h`)
- Header-only, inline function
- Counts byte frequency distribution over the payload, computes `-Σ p·log₂(p)`
- Returns 0.0–8.0 bits
- Interpretation: >7.0 = encrypted/compressed, <3.0 = plaintext
- Accumulated as a running mean per flow

### TLS/JA3 Fingerprinting (`tls_parser.h/.cpp`)
- Detects TLS record layer (content type 0x16) and ClientHello (handshake type 0x01)
- Extracts: TLS version, cipher suite list, extension list, elliptic curves, EC point formats
- Filters GREASE values per RFC 8701: `(val & 0x0F0F) == 0x0A0A`
- Builds JA3 string: `TLSVersion,Ciphers,Extensions,EllipticCurves,ECPointFormats` with `-` separators within fields
- MD5 hash via OpenSSL (`-lcrypto`)
- Returns `std::optional<JA3Result>` — nullopt if not a ClientHello
- Only the first ClientHello per flow is captured (subsequent ones ignored)

### DNS Parsing (`dns_parser.h/.cpp`)
- Parses DNS query packets (QR bit = 0)
- Extracts domain name by walking label-length-prefixed sections
- Guards against pointer compression (rejects if encountered)
- Extracts query type (A=1, AAAA=28, MX=15, TXT=16, etc.)
- Per-source-IP tracking: query count, unique domain set, TXT query ratio

### Derived Metrics (computed at export time)
- `packets_per_sec` = packet_count / duration
- `bytes_per_sec` = total_bytes / duration
- `syn_ack_ratio` = syn_count / ack_count
- `window_size_mean` = window_size_sum / packet_count
- `payload_entropy_mean` = entropy_sum / entropy_count
- `payload_size_mean` = payload_size_sum / payload_count
- Inter-arrival: mean, stddev, min, max computed from timestamp deltas

---

## 8. Export

### JSON (`flow_export.json`)
Every flow is exported with all tracked fields: packet/byte counts, all 6 flag counts, directional splits, window size stats, timing stats, inter-arrival stats, payload entropy/size stats, JA3 fields, TTL.

### DNS JSON (`dns_export.json`)
Separate file for DNS statistics per source IP: query count, unique domain count, TXT query ratio.

### Terminal Summary
Compact table printed to stdout on shutdown with key metrics per flow: packets, bytes, flags, directional counts, duration, pps, entropy mean, window average, JA3 presence.

---

## 9. ML Client (`bridge/ml_client.h/.cpp`)

- Connects to a Python ML inference service over a Unix domain socket (`AF_UNIX`, `SOCK_STREAM`)
- Default path: `/tmp/providence_ml.sock` (configurable via `--ml-socket`)
- Wire protocol: 4-byte big-endian length prefix + serialized protobuf payload
- Sends `FeatureVector`, receives `Classification`
- 500ms read timeout via `SO_RCVTIMEO`
- One automatic reconnect attempt on write failure
- Returns `std::optional<Classification>` — nullopt on any failure
- A mock Python server (`tests/mock_ml_server.py`) is provided for testing; it always returns `{category: "BENIGN", confidence: 0.95}`

---

## 10. gRPC Dispatcher (`dispatcher/grpc_dispatcher.h/.cpp`)

- Sends `ClassifiedEvent` messages to The Citadel backend via gRPC
- Default target: `localhost:50051` (configurable via `--citadel`)
- Uses `grpc::InsecureChannelCredentials()` (TLS is a later concern)
- 2-second deadline per RPC call
- Compile-time `HAS_GRPC` guard: if gRPC is not found by CMake, the dispatcher compiles but logs events to stderr instead of sending them
- Never crashes if The Citadel is down — fails gracefully and continues capture

---

## 11. Protobuf Schemas (`proto/`)

Three proto3 schemas define the data contracts across all Providence components:

| File | Messages | Purpose |
|---|---|---|
| `features.proto` | `FeatureVector` (40 fields) | Network/transport/timing/payload/TLS/DNS features |
| `event.proto` | `Classification`, `ClassifiedEvent`, `EventAck`, `EventService` | Classified events from Eye → Citadel, including gRPC service |
| `response.proto` | `ResponseAction` | Response directives (OBSERVE, ALERT, BLOCK, RATE_LIMIT) |

Classification categories: `BENIGN`, `DOS`, `PROBE`, `BRUTE_FORCE`, `INJECTION`, `EXFILTRATION`, `AI_AGENT`.

---

## 12. Build System

### CMake (`eye/CMakeLists.txt`)
- Minimum CMake 3.16, C++17 required
- Dependencies found via: `find_package(Threads)`, `pkg_check_modules(libpcap)`, `find_package(OpenSSL)`, `find_package(Protobuf)`, `find_package(gRPC CONFIG QUIET)`
- Protobuf `.pb.cc/.pb.h` generated via custom commands from `../proto/*.proto`
- gRPC stubs generated only if gRPC is found and `grpc_cpp_plugin` exists
- `HAS_GRPC` compile definition set conditionally
- Release flags: `-Wall -Wextra -O2`; Debug: `-Wall -Wextra -g -O0`
- Subdirectories: `tests/` (GTest via FetchContent) and `benchmarks/`

### Docker (`eye/Dockerfile`)
- Multi-stage build on Ubuntu 24.04
- Builder stage installs: build-essential, cmake, pkg-config, libpcap-dev, libssl-dev, protobuf-compiler, libprotobuf-dev, libgrpc++-dev
- Runtime stage: minimal with only shared libraries
- Default interface: `eth0` (Linux)
- Requires `--cap-add=NET_RAW --network=host`

---

## 13. Tests (`eye/tests/`)

Google Test v1.14.0 fetched via CMake FetchContent. Five test suites:

| Suite | Coverage |
|---|---|
| `test_ring_buffer` | Push/pop single, full buffer rejection, empty pop, FIFO ordering, timestamp preservation, concurrent SPSC with 10K packets |
| `test_entropy` | All-identical bytes (≈0.0), uniform distribution (≈8.0), known string hand-calculated, empty buffer |
| `test_tls_parser` | Valid ClientHello (version, ciphers, extensions, curves, point formats), non-TLS rejection, truncated rejection, empty buffer, ServerHello rejection, GREASE filtering verification |
| `test_dns_parser` | Valid A query, response rejection, zero QDCOUNT, truncated data, multi-label domain, TXT query type |
| `test_flow_tracker` | Same-flow merging, bidirectional keying, SYN flag counting, payload entropy, zero-payload counting, window size tracking |

Each test links only the sources it needs — no pcap dependency in tests.

---

## 14. Benchmarks (`eye/benchmarks/`)

`throughput_bench.cpp` measures raw processing throughput without pcap or ring buffer overhead:

- 100,000 synthetic Ethernet+IPv4+TCP packets (~200 bytes each) through `process_packet()`
- 100,000 synthetic TLS ClientHello payloads through `parse_ja3()`
- 100,000 synthetic DNS queries through `parse_dns_query()`
- Reports: packet count, elapsed microseconds, packets/sec, estimated Mbps

---

## 15. Key Design Decisions

| Decision | Rationale |
|---|---|
| Lock-free SPSC ring buffer | Decouples capture from processing; capture callback must be as thin as possible to avoid packet drops |
| Heap-allocated ring buffer slots | 4096 × 65KB = 256MB; stack allocation would segfault |
| `std::unordered_map` over `std::map` | O(1) vs O(log n) lookups; necessary for throughput targets |
| `std::optional<long>` for `first_seen` | Replaces fragile `== 0` sentinel; self-documenting, no implicit epoch assumption |
| Explicit `uint8_t` casts in all byte parsing | Prevents signed-char platform bugs (negative IP octets, sign extension in port parsing) |
| IHL-aware TCP offset | Handles IP options correctly; hardcoded offsets break on options |
| Bidirectional lexicographic flow key | Simple, deterministic, merges both directions without state |
| `HAS_GRPC` compile guard | Eye builds and runs without gRPC installed; graceful degradation |
| Separate DNS export file | DNS stats are per-source-IP, not per-flow; different granularity than TCP flow data |
| JA3 only on first ClientHello | One fingerprint per flow is sufficient; avoids redundant MD5 computation |
| 100µs spin sleep in processor | Reasonable latency/CPU tradeoff for idle periods; tunable for production |
| Forward direction = first packet | Simple heuristic; works for client-initiated flows which are the common case |

---

## 16. Known Limitations and Future Work

| Item | Status | Notes |
|---|---|---|
| Flow expiration / timeout | Not implemented | Flows accumulate indefinitely; needs eviction policy for long-running captures |
| Payload entropy per-packet granularity | Seconds only | Timestamps are `tv_sec` (1s resolution); microsecond inter-arrival needs `tv_usec` |
| Ring buffer full-copy on pop | Known overhead | Could return pointer/index instead; acceptable for current throughput |
| No ICMP support | BPF filter excludes it | ICMP is a recon/exfil vector; filter expansion planned |
| No UDP flow tracking | DNS only | General UDP flows not tracked; only port 53 queries parsed |
| ML client not wired into processor loop | Stub ready | `MlClient` and `GrpcDispatcher` are constructed in main but not called from the processor yet; needs flow completion trigger logic |
| No TLS certificate metadata | JA3 only | Certificate chain parsing would add OS fingerprinting and CA trust signals |
| No protobuf serialization in export path | JSON only | JSON export works; protobuf serialization for the Unix socket handoff is the next step |
| Condition variable for processor idle | Uses spin sleep | `sleep_for(100µs)` is fine for now; condition variable would reduce CPU in low-traffic periods |
| Test isolation | Shared static state | `flow_tracker.cpp` uses file-static maps; tests share state across cases. Refactoring to an object would fix this |

---

## 17. CLI Usage

```
./eye [interface] [--citadel host:port] [--ml-socket path] [--help]
```

| Argument | Default | Description |
|---|---|---|
| `interface` | `en0` | Network interface to capture on |
| `--citadel` | `localhost:50051` | gRPC target for The Citadel backend |
| `--ml-socket` | `/tmp/providence_ml.sock` | Unix socket path for ML inference service |

### Docker

```bash
docker build -t providence-eye -f eye/Dockerfile .
docker run --cap-add=NET_RAW --network=host providence-eye eth0
```

### Build from source

```bash
cd eye
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
./build/eye en0
```

### Run tests

```bash
cd eye/build
ctest --output-on-failure
```

### Run benchmarks

```bash
./build/benchmarks/throughput_bench
```
