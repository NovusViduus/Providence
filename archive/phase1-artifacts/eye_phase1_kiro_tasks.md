# The Eye — Phase 1 Remaining Tasks (Kiro Instructions)

Project: **Providence** — Network Security Intelligence Platform
Component: **The Eye** (`eye/` directory) — C++ local packet capture agent
Context: Packet capture, ring buffer, flow tracking, TLS/JA3 parsing, DNS parsing, and JSON export are already implemented. The files below exist and are working: `main.cpp`, `capture.cpp`, `capture.h`, `processor.cpp`, `processor.h`, `flow_table.cpp`, `flow_table.h`, `ring_buffer.h`, `tls_parser.cpp`, `tls_parser.h`, `dns_parser.cpp`, `dns_parser.h`, `entropy.h`, `features.h`, `Makefile`.

---

## Task 1: Protobuf Schemas

**Goal:** Define protobuf schemas that formalize the data contracts between The Eye (C++), the ML service (Python), and The Citadel (Java). These go in `proto/` at the repo root, not inside `eye/`.

**Create these files:**

### `proto/features.proto`

Translate the existing `features.h` struct into a protobuf message. Use `syntax = "proto3";` and `package providence;`. The message should be called `FeatureVector` and must include every field from the existing C++ struct:

- `string src_ip`, `string dst_ip`, `uint32 src_port`, `uint32 dst_port`, `uint32 protocol`, `uint32 ttl`
- Flag counts: `int32 syn_count`, `ack_count`, `fin_count`, `rst_count`, `psh_count`, `urg_count`
- Window sizes: `uint32 window_size_min`, `window_size_max`, `double window_size_mean`
- Timing: `int64 duration`, `double packets_per_sec`, `bytes_per_sec`, `inter_arrival_mean`, `inter_arrival_std`, `int64 inter_arrival_min`, `inter_arrival_max`
- Directional: `int32 packet_count`, `total_bytes`, `packet_count_fwd`, `packet_count_bwd`, `bytes_fwd`, `bytes_bwd`
- Payload: `double payload_entropy_mean`, `uint32 payload_size_min`, `payload_size_max`, `double payload_size_mean`, `int32 zero_payload_count`
- TLS: `string ja3_hash`, `bool ja3_seen`, `int32 cipher_suite_count`, `extension_count`
- DNS: `int32 dns_query_count`, `dns_unique_domains`, `double dns_txt_query_ratio`

### `proto/event.proto`

A classified event message sent from The Eye to The Citadel. Import `features.proto`. Message `ClassifiedEvent`:

- `string event_id` (UUID)
- `int64 timestamp` (epoch millis)
- `string flow_key` (the `"A <-> B"` string)
- `FeatureVector features`
- `Classification classification` — a nested message with:
  - `string category` (one of: `BENIGN`, `DOS`, `PROBE`, `BRUTE_FORCE`, `INJECTION`, `EXFILTRATION`, `AI_AGENT`)
  - `string subcategory`
  - `double confidence` (0.0–1.0)
  - `map<string, double> feature_importances`

### `proto/response.proto`

A response action message. Message `ResponseAction`:

- `string event_id`
- `string action_type` (e.g. `OBSERVE`, `ALERT`, `BLOCK`, `RATE_LIMIT`)
- `string target_ip`
- `int64 ttl_seconds`
- `double confidence`
- `string rationale`

**Do not** generate C++/Python/Java stubs yet — just define the `.proto` files. Stub generation will be handled by the build system in later tasks.

---

## Task 2: CMake Build System

**Goal:** Replace the existing `Makefile` with a `CMakeLists.txt` that builds The Eye binary, finds dependencies, compiles protobuf schemas, and sets up test/benchmark targets.

**Create `eye/CMakeLists.txt`:**

```
cmake_minimum_required(VERSION 3.16)
project(eye LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
```

Requirements:
- Use `find_package` for: `Threads`, `PkgConfig` (then `pkg_check_modules` for `libpcap`), `OpenSSL`, `Protobuf`, `gRPC`
- Protobuf: use `protobuf_generate_cpp` on the `.proto` files in `../proto/` to generate C++ sources. Add the generated headers to the include path.
- Define the main `eye` executable target from: `src/main.cpp`, `src/capture/packet_capture.cpp`, `src/features/flow_table.cpp`, `src/features/tls_parser.cpp`, `src/features/dns_parser.cpp`, `src/processor.cpp`, `src/bridge/ml_client.cpp`, `src/dispatcher/grpc_dispatcher.cpp`, plus the generated protobuf sources.
- Link against: `pcap`, `Threads::Threads`, `OpenSSL::Crypto`, `protobuf::libprotobuf`, gRPC libraries.
- Add a `tests` subdirectory (see Task 5).
- Add a `benchmarks` subdirectory (see Task 6).
- Compile flags: `-Wall -Wextra -O2` for Release, `-Wall -Wextra -g -O0` for Debug.

**Also reorganize the source tree** to match the design doc structure. Move existing files:

```
eye/
├── CMakeLists.txt
├── src/
│   ├── capture/
│   │   ├── packet_capture.h      (was capture.h)
│   │   ├── packet_capture.cpp    (was capture.cpp)
│   │   └── ring_buffer.h         (unchanged)
│   ├── features/
│   │   ├── feature_extractor.h   (was features.h — rename struct)
│   │   ├── flow_tracker.h        (was flow_table.h)
│   │   ├── flow_tracker.cpp      (was flow_table.cpp)
│   │   ├── tls_parser.h          (unchanged)
│   │   ├── tls_parser.cpp        (unchanged)
│   │   ├── dns_parser.h          (unchanged)
│   │   ├── dns_parser.cpp        (unchanged)
│   │   └── entropy.h             (unchanged)
│   ├── bridge/
│   │   ├── ml_client.h           (new — Task 3)
│   │   └── ml_client.cpp         (new — Task 3)
│   ├── dispatcher/
│   │   ├── grpc_dispatcher.h     (new — Task 4)
│   │   └── grpc_dispatcher.cpp   (new — Task 4)
│   ├── processor.h               (unchanged)
│   ├── processor.cpp             (unchanged)
│   └── main.cpp                  (unchanged)
├── tests/
│   └── (see Task 5)
└── benchmarks/
    └── (see Task 6)
```

Update all `#include` paths in every file to match the new directory layout after moving.

---

## Task 3: Unix Domain Socket ML Client

**Goal:** Implement the C++ client that sends serialized `FeatureVector` protobuf messages to the Python ML inference service over a Unix domain socket and reads back classification results.

**Create `eye/src/bridge/ml_client.h` and `eye/src/bridge/ml_client.cpp`.**

### Interface (`ml_client.h`)

```cpp
#ifndef ML_CLIENT_H
#define ML_CLIENT_H

#include <string>
#include <optional>
#include "features.proto.pb.h"  // generated protobuf header
#include "event.proto.pb.h"

class MlClient {
public:
    // socket_path defaults to "/tmp/providence_ml.sock"
    explicit MlClient(const std::string& socket_path = "/tmp/providence_ml.sock");
    ~MlClient();

    bool connect();
    void disconnect();
    bool is_connected() const;

    // Send a feature vector, receive a classification.
    // Returns nullopt on connection failure or timeout.
    std::optional<providence::Classification> classify(const providence::FeatureVector& features);

private:
    std::string socket_path_;
    int fd_ = -1;
};

#endif
```

### Implementation details (`ml_client.cpp`)

- Use `AF_UNIX` / `SOCK_STREAM` socket.
- **Wire protocol:** Length-prefixed protobuf. Send a 4-byte big-endian uint32 containing the serialized message size, followed by the serialized `FeatureVector` bytes. Read back a 4-byte length prefix followed by a serialized `Classification` message.
- `classify()` should: serialize the `FeatureVector` to a string, write the length prefix + payload, read the response length prefix + payload, deserialize into `Classification`, return it.
- Handle errors gracefully: if the socket is not connected or the write/read fails, return `std::nullopt`. Log errors to stderr.
- Include a reconnect attempt if the connection drops (one retry, then give up and return nullopt).
- Set a 500ms read timeout using `setsockopt` with `SO_RCVTIMEO`.

### Integration into the pipeline

Modify `processor.cpp`: after calling `process_packet()`, if a flow has accumulated enough packets (e.g., every 10 packets or on flow completion via FIN/RST), build a `FeatureVector` from the flow's `FlowStats`, call `ml_client.classify()`, and if a result is returned, pass it to the gRPC dispatcher (Task 4). For now, just log the classification to stdout if the dispatcher isn't ready yet.

The Python ML service side is **not part of this task** — it will be built in Phase 3. For testing, create a tiny Python echo server script at `eye/tests/mock_ml_server.py` that:
- Listens on `/tmp/providence_ml.sock`
- Reads the length-prefixed FeatureVector
- Always responds with a Classification of `{category: "BENIGN", confidence: 0.95}`
- This lets you verify the C++ client works end-to-end

---

## Task 4: gRPC Event Dispatcher

**Goal:** Implement the C++ gRPC client that sends `ClassifiedEvent` messages to The Citadel backend.

**Create `eye/src/dispatcher/grpc_dispatcher.h` and `eye/src/dispatcher/grpc_dispatcher.cpp`.**

### Proto service definition

Add to `proto/event.proto`:

```protobuf
service EventService {
    rpc SubmitEvent (ClassifiedEvent) returns (EventAck);
    rpc StreamEvents (stream ClassifiedEvent) returns (stream EventAck);
}

message EventAck {
    string event_id = 1;
    bool accepted = 2;
}
```

### Interface (`grpc_dispatcher.h`)

```cpp
#ifndef GRPC_DISPATCHER_H
#define GRPC_DISPATCHER_H

#include <string>
#include <memory>
#include <grpcpp/grpcpp.h>
#include "event.grpc.pb.h"

class GrpcDispatcher {
public:
    // target defaults to "localhost:50051"
    explicit GrpcDispatcher(const std::string& target = "localhost:50051");

    bool connect();
    bool dispatch(const providence::ClassifiedEvent& event);

private:
    std::string target_;
    std::shared_ptr<grpc::Channel> channel_;
    std::unique_ptr<providence::EventService::Stub> stub_;
};

#endif
```

### Implementation details (`grpc_dispatcher.cpp`)

- Use `grpc::CreateChannel` with `grpc::InsecureChannelCredentials()` (TLS is a later concern).
- `dispatch()`: create a `ClientContext`, set a 2-second deadline, call `stub_->SubmitEvent()`, return `true` if the response `accepted` is true.
- If The Citadel is not running, `dispatch()` should fail gracefully (log a warning, return false). The Eye must never crash because the backend is down.
- **The Citadel server does not exist yet** (Phase 2). For now, the dispatcher is a client stub that compiles and handles connection failure gracefully. It will be tested end-to-end once the Java backend exists.

### Integration

In `main.cpp`, construct a `GrpcDispatcher`. Pass it to the processor thread. When classification results come back from the ML client, build a `ClassifiedEvent` (generate a UUID for `event_id`, populate timestamp and flow key), and call `dispatcher.dispatch()`. If dispatch fails, log and continue — do not block capture.

Make the Citadel target address configurable via command-line argument (e.g., `./eye en0 --citadel localhost:50051`). Default to `localhost:50051`.

---

## Task 5: Unit Tests

**Goal:** Write comprehensive unit tests using Google Test. Create `eye/tests/CMakeLists.txt` that fetches GTest via `FetchContent`.

**Create these test files:**

### `eye/tests/test_ring_buffer.cpp`

Test the lock-free ring buffer (`ring_buffer.h`). Cases:
- Push and pop a single packet — verify data and length match.
- Push until the buffer is full — verify `try_push` returns false.
- Pop from empty buffer — verify `try_pop` returns false.
- Fill and drain the buffer — verify all packets come out in FIFO order.
- Concurrent test: spawn a producer thread that pushes 10,000 packets and a consumer thread that pops them. Verify all packets are received, none are corrupted, and count matches.
- Verify `tv_sec` timestamp is preserved through push/pop.

### `eye/tests/test_tls_parser.cpp`

Test `parse_ja3()`. Cases:
- Pass a valid TLS ClientHello byte sequence (hardcode one — you can capture a real one or construct it byte-by-byte). Verify that `ja3_hash` is a 32-character hex string, `tls_version` is `0x0301` or `0x0303`, `cipher_suites` is non-empty, `extensions` is non-empty.
- Pass a non-TLS payload (e.g., HTTP GET request bytes). Verify `parse_ja3()` returns `std::nullopt`.
- Pass a truncated ClientHello (cut off in the middle of cipher suites). Verify `std::nullopt`.
- Pass an empty buffer. Verify `std::nullopt`.
- Pass a TLS record that is not a ClientHello (e.g., handshake type 0x02 = ServerHello). Verify `std::nullopt`.
- Verify GREASE values are filtered out of cipher suites and extensions.

### `eye/tests/test_dns_parser.cpp`

Test `parse_dns_query()`. Cases:
- Pass a valid DNS query for `example.com` (type A = 1). Construct the bytes: header (12 bytes, QR=0, QDCOUNT=1) + question section (labels: `\x07example\x03com\x00` + QTYPE `\x00\x01` + QCLASS `\x00\x01`). Verify `domain == "example.com"` and `query_type == 1`.
- Pass a DNS response (QR bit = 1). Verify `std::nullopt`.
- Pass a query with QDCOUNT = 0. Verify `std::nullopt`.
- Pass truncated data (< 12 bytes). Verify `std::nullopt`.
- Pass a multi-label domain like `sub.domain.example.com`. Verify correct reconstruction.
- Pass a TXT query (type 16). Verify `query_type == 16`.

### `eye/tests/test_flow_tracker.cpp`

Test flow tracking logic in `flow_table.cpp`. This requires making the flow table testable — either expose the `flows` map via a getter or refactor to accept a flow table object. Test:
- Process two packets with the same 5-tuple — verify they land in the same flow and `packet_count == 2`.
- Process two packets with swapped src/dst — verify they land in the same flow (bidirectional keying) and `packet_count_fwd` / `packet_count_bwd` are each 1.
- Process a SYN packet — verify `syn_count` increments.
- Process a packet with payload — verify entropy is calculated (non-zero `entropy_sum`).
- Process a packet with zero payload — verify `zero_payload_count` increments.
- Verify `first_seen` and `last_seen` timestamps are set correctly.
- Verify window size min/max/sum tracking.

### `eye/tests/test_entropy.cpp`

Test `shannon_entropy()`:
- All identical bytes (e.g., 256 bytes of `0x00`). Verify entropy ≈ 0.0.
- Perfectly uniform distribution (each byte value 0–255 appears exactly once). Verify entropy ≈ 8.0.
- Known string like `"aaab"`. Calculate expected entropy by hand and verify within ±0.01.
- Empty buffer (len=0). Verify returns 0.0.

### `eye/tests/CMakeLists.txt`

```cmake
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG v1.14.0
)
FetchContent_MakeAvailable(googletest)

enable_testing()

# Add test executables for each test file
# Link against gtest_main and the relevant source files
```

Each test executable should link against `gtest_main` and compile only the source files it actually tests (not the full Eye binary — no `main.cpp`, no pcap).

---

## Task 6: Throughput Benchmark

**Goal:** Measure how many packets/sec The Eye can process through its feature extraction pipeline (excluding live capture). This validates the design doc's 1 Gbps target.

**Create `eye/benchmarks/throughput_bench.cpp`:**

- Generate synthetic packets in memory: create an array of 100,000 fake Ethernet+IP+TCP frames with randomized IPs, ports, flags, and payload bytes. Each packet ~200 bytes (typical).
- Time how long it takes to push all packets through `process_packet()` in a tight loop (no ring buffer, no pcap — direct function calls).
- Report: total packets, elapsed time (microseconds), packets/sec, estimated Mbps (packets × avg_size × 8 / elapsed).
- Run the same benchmark with `parse_ja3()` on synthetic TLS ClientHello payloads — measure JA3 parsing throughput separately.
- Run the same benchmark with `parse_dns_query()` on synthetic DNS query payloads.
- Use `std::chrono::high_resolution_clock` for timing.
- Print results in a clean table to stdout.

### `eye/benchmarks/CMakeLists.txt`

Add a `throughput_bench` executable target. Link against the same sources as the test targets (flow_table, tls_parser, dns_parser, entropy). No pcap dependency needed.

---

## Task 7: Dockerfile

**Goal:** Containerize The Eye for Linux builds and CI.

**Create `eye/Dockerfile`:**

```dockerfile
FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential cmake pkg-config \
    libpcap-dev libssl-dev \
    protobuf-compiler libprotobuf-dev \
    libgrpc++-dev protobuf-compiler-grpc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY proto/ /app/proto/
COPY eye/ /app/eye/

WORKDIR /app/eye
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y \
    libpcap0.8 libssl3 libprotobuf32 libgrpc++1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/eye/build/eye /usr/local/bin/eye

# Requires NET_RAW capability for packet capture
# Run with: docker run --cap-add=NET_RAW --network=host providence-eye
ENTRYPOINT ["eye"]
CMD ["eth0"]
```

Key points:
- Multi-stage build to keep the final image small.
- The default interface is `eth0` (Linux convention, not `en0` like macOS).
- Must run with `--cap-add=NET_RAW --network=host` to capture packets.
- Include a comment noting this.

---

## Build Order

These tasks have dependencies. Build them in this order:

1. **Task 1** (Protobuf schemas) — no code dependencies, just `.proto` files
2. **Task 2** (CMake + directory restructure) — depends on Task 1 for proto paths
3. **Task 5** (Unit tests) — can begin once CMake is working; tests validate existing code
4. **Task 6** (Benchmarks) — same as tests, just needs CMake
5. **Task 3** (ML client) — depends on Task 1 for generated protobuf headers
6. **Task 4** (gRPC dispatcher) — depends on Task 1 for generated gRPC stubs
7. **Task 7** (Dockerfile) — do last, once everything compiles under CMake
