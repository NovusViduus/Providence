# The Eye — Feature Extraction Plan

## New Files

### `eye/entropy.h`
Header-only Shannon entropy calculator. Takes a byte buffer, returns entropy in bits (0.0–8.0). High entropy (>7.0) flags encrypted/compressed payloads; low entropy (<3.0) indicates plaintext. Used per-packet to populate a running average on the flow.

### `eye/tls_parser.h` + `eye/tls_parser.cpp`
Parses TLS ClientHello messages to extract JA3 fingerprints. Needs to:
- Detect TLS record layer (content type 0x16, handshake type 0x01) at the TCP payload offset
- Extract: TLS version, cipher suite list, extension list, elliptic curve list, EC point format list
- Concatenate fields with commas, MD5 hash the result → JA3 string
- Return a struct with the raw components plus the final hash, or `std::nullopt` if the packet isn't a ClientHello

Key reference: the JA3 spec concatenates `TLSVersion,Ciphers,Extensions,EllipticCurves,EllipticCurvePointFormats` with `-` between fields and `,` between values within a field, then MD5s the whole string. GREASE values must be filtered out.

### `eye/dns_parser.h` + `eye/dns_parser.cpp`
Parses DNS query packets (UDP port 53) to extract queried domain names. Your current BPF filter is `tcp` only, so this requires either:
- Changing the filter to `tcp or udp port 53`, or
- Adding a second capture handle for DNS

Extracts: query domain, query type (A, AAAA, MX, TXT, etc.), and timestamps. DNS tunneling detection later uses query frequency and TXT record response sizes as features.

### `eye/features.h`
Defines the canonical `FeatureVector` struct that will eventually be serialized via protobuf and sent over the Unix socket to the ML service. Fields:

**Network layer:**
- `src_ip`, `dst_ip`, `src_port`, `dst_port`, `protocol`
- `ttl` (from IP header — useful for OS fingerprinting and hop-count anomalies)

**Transport layer (already partially tracked, needs additions):**
- `syn`, `ack`, `fin`, `rst`, `psh` counts (existing)
- `window_size_min`, `window_size_max`, `window_size_mean` (new — from TCP header bytes 14–15)
- `urgent_count` (URG flag, rarely set legitimately)

**Flow-level (timing):**
- `duration` (existing)
- `packets_per_sec`, `bytes_per_sec` (existing as derived)
- `inter_arrival_mean`, `inter_arrival_std`, `inter_arrival_min`, `inter_arrival_max` (new — requires storing per-packet timestamps, not just first/last)
- `packet_count_fwd`, `packet_count_bwd` (directional split)
- `bytes_fwd`, `bytes_bwd`

**Payload analysis:**
- `payload_entropy_mean` (new — from `entropy.h`)
- `payload_size_min`, `payload_size_max`, `payload_size_mean` (new)
- `zero_payload_count` (packets with no TCP payload — common in scans)

**TLS (new):**
- `ja3_hash` (string, from `tls_parser`)
- `ja3_seen` (bool — did this flow contain a ClientHello?)
- `cipher_suite_count` (number offered — low counts suggest automated tools)
- `extension_count`

**DNS (new):**
- `dns_query_count` (per flow or globally per source IP)
- `dns_unique_domains` (cardinality — high count from one IP suggests tunneling or recon)
- `dns_query_type_distribution` (fraction of TXT queries — high TXT ratio flags tunneling)

## Modified Files

### `eye/flow_table.h` + `eye/flow_table.cpp`
The `FlowStats` struct expands to hold all the new fields above. Main changes:
- Add a small `std::vector<long>` (or fixed ring) of recent packet timestamps per flow for inter-arrival calculation
- Track per-packet payload sizes for min/max/mean
- Track window sizes
- Store directional byte/packet counts (requires knowing which direction the packet is going relative to the flow key)
- Store `ja3_hash` from the first ClientHello seen on the flow
- Compute entropy per packet, accumulate running mean
- `export_json()` and `print_summary()` updated to include new fields

### `eye/capture.cpp` + `eye/capture.h`
- Change BPF filter from `"tcp"` to `"tcp or udp port 53"` to capture DNS
- Pass protocol info so the processor knows whether to run TCP or DNS parsing

### `eye/processor.cpp`
- Route packets to either `process_packet()` (TCP) or a new `process_dns_packet()` based on IP protocol field (6 = TCP, 17 = UDP)

### `eye/Makefile`
- Add `tls_parser.o` and `dns_parser.o` to `SRCS`
- Add `-lcrypto` to `LDFLAGS` for MD5 (JA3 hashing) — from OpenSSL

## Build Dependency

JA3 uses MD5 for the final hash. Options:
- Link OpenSSL (`-lcrypto`) — already available on macOS and Linux
- Embed a small standalone MD5 implementation to avoid the dependency

OpenSSL is the cleaner choice since you'll likely need it later anyway for certificate metadata parsing.

## Implementation Order

1. **`entropy.h`** — standalone, no dependencies, easy to unit test
2. **`features.h`** — define the struct so everything else has a target to populate
3. **`tls_parser`** — most complex, highest signal for the ML model
4. **Upgrade `flow_table`** — wire in entropy, timing, window sizes, TLS results
5. **`dns_parser`** + capture filter change — last because it requires the BPF filter change and a new packet routing path
6. **Update `Makefile`**
