# The Eye — Code Review
> `eye.cpp` · Phase 1 Proof-of-Concept

---

## What It's Doing

The current implementation is a Phase 1 proof-of-concept that:

1. Opens a live capture on `en0` (hardcoded to the Mac's primary interface) with libpcap
2. Filters to TCP only via BPF
3. Parses raw packet bytes manually — extracts src/dst IPs (offsets 26–33), ports (34–37), TCP flags (47)
4. Tracks bidirectional flows using a string key (`ip:port <-> ip:port`), lexicographically ordered so direction doesn't matter
5. Aggregates per-flow stats: packet count, bytes, SYN/ACK/FIN/RST/PSH flag counts, first/last seen timestamps
6. Derives metrics: duration, packets/sec, SYN-to-ACK ratio
7. On SIGINT (Ctrl+C): breaks the loop, prints a formatted flow table to stdout, exports `flow_export.json`

---

## What It's Doing Well

**Bidirectional flow keying** — the lexicographic sort is a clean trick that correctly merges both directions of a conversation into one record.

**Signal handling** — `SIGINT → pcap_breakloop` is the correct pattern, not a hard kill.

**JSON export** — already thinking about downstream consumption; the JSON structure maps cleanly to what the ML pipeline will eventually need.

**Derived features** — SYN/ACK ratio and packets/sec are genuinely useful signals for detecting SYN floods and port scans.

**Correct flag bitmasks** — `0x02` (SYN), `0x10` (ACK), `0x01` (FIN), `0x04` (RST) are all correct.

---

## Issues & Gaps

### 🔴 Critical / Correctness

**1. Unchecked `pcap_compile` / `pcap_setfilter` return values**

Both functions return `-1` on failure, but their return values are never checked. If BPF compilation fails silently, the filter is never applied and you capture unfiltered traffic — with no indication anything went wrong. Every libpcap call that can fail should check the return value and handle the error explicitly.

```cpp
if (pcap_compile(handle, &filter, "tcp", 0, PCAP_NETMASK_UNKNOWN) == -1) {
    std::cerr << "pcap_compile failed: " << pcap_geterr(handle) << "\n";
    return 1;
}
if (pcap_setfilter(handle, &filter) == -1) {
    std::cerr << "pcap_setfilter failed: " << pcap_geterr(handle) << "\n";
    return 1;
}
```

**2. IHL-aware TCP offset parsing missing**

The parser assumes Ethernet → IPv4 → TCP with no variable-length header handling. An IP header with options (IHL > 5) shifts the TCP header, and the code will silently read garbage from the wrong offsets. Needs proper IHL parsing:

```cpp
uint8_t ihl = (pkt[14] & 0x0F) * 4;  // ethernet header = 14 bytes
uint16_t src_port = (pkt[14 + ihl] << 8) | pkt[14 + ihl + 1];
```

**3. Signed `char` in `snprintf` IP formatting**

`pkt[26]` etc. are `u_char` in the libpcap API, but on some platforms the underlying `char` is signed. Passing a potentially signed value to `%d` can produce negative octets like `-127.0.0.1`. Should be explicitly cast:

```cpp
snprintf(src_buf, sizeof(src_buf), "%d.%d.%d.%d",
    (uint8_t)pkt[26], (uint8_t)pkt[27], (uint8_t)pkt[28], (uint8_t)pkt[29]);
```

**4. Hardcoded interface `"en0"`**

Immediately breaks on Linux (`eth0`, `ens3`, etc.) and any Mac where the primary interface isn't `en0`. Should be a CLI argument:

```cpp
int main(int argc, char* argv[]) {
    const char* iface = argc > 1 ? argv[1] : "en0";
    pcap_t* handle = pcap_open_live(iface, 65535, 1, 1000, errbuf);
```

**5. PSH flag tracked in struct but never set**

`psh_count` exists in `FlowStats` but the callback never increments it. Either wire it up or remove it:

```cpp
if (flags & 0x08) flows[key].psh_count++;
```

---

### 🟡 Code Quality

**6. `first_seen == 0` as uninitialized sentinel is fragile**

Using epoch 0 as a "not yet set" marker is a magic value. It works in practice (you're not capturing 1970 traffic), but it's brittle by design and signals intent poorly. A `bool initialized` flag or `std::optional<long>` makes the code self-documenting and eliminates the implicit assumption:

```cpp
std::optional<long> first_seen;
// ...
if (!flows[key].first_seen.has_value()) flows[key].first_seen = timestamp;
```

**7. `std::map<std::string, FlowStats>` — not fast enough for production**

`std::map` is O(log n) per lookup with string key comparisons. For the design target of 1 Gbps sustained throughput, this will be a bottleneck. Switch to `std::unordered_map` now, and plan for a lock-free hash table when the ring buffer and worker thread are introduced.

**8. Link-layer type not checked**

libpcap can operate over different link layer types — loopback uses `DLT_NULL` with a 4-byte header rather than Ethernet's 14. Hardcoded offsets will be wrong in those cases. Should check `pcap_datalink()` and adjust accordingly.

---

### 🟠 Architecture / Phase 2 Readiness

**9. No ring buffer**

The design spec calls for a lock-free ring buffer between capture and processing. Currently everything runs inline in the callback — fine for a prototype, but the callback should be as thin as possible (enqueue packet, return). Heavy processing belongs on a worker thread.

**10. No flow expiration / timeout**

Flows accumulate in memory indefinitely. A long-running capture on a busy network will exhaust RAM. Need a timeout policy (e.g., evict flows idle for >120s). This also matters for correctly computing flow duration on connections that never close cleanly with FIN/RST.

**11. No payload entropy**

The design doc calls for payload entropy as a feature (high entropy → possible encryption/exfiltration). The raw packet bytes are already available in the callback — just needs a Shannon entropy calculation over the payload slice. This is one of the more valuable features for the ML pipeline.

**12. UDP/ICMP blindspot**

The BPF filter is `"tcp"` only. Port scans frequently use UDP, and ICMP is a classic reconnaissance and exfiltration vector. The filter should be expanded or removed when the protocol coverage widens.

**13. No protobuf serialization**

The JSON export is a sensible interim step, but the target is protobuf serialization for the Unix socket handoff to the Python ML service. The current JSON schema maps cleanly to what those protobuf structs will look like — good forward thinking.

---

## Priority Order

| Priority | Item |
|---|---|
| 🔴 | Check `pcap_compile` / `pcap_setfilter` return values |
| 🔴 | Fix IHL-aware TCP offset parsing |
| 🔴 | Cast `pkt` bytes to `uint8_t` in `snprintf` |
| 🔴 | CLI argument for interface selection |
| 🔴 | Wire up PSH flag |
| 🟡 | Replace `first_seen == 0` sentinel with `std::optional` or bool flag |
| 🟡 | Switch `std::map` → `std::unordered_map` |
| 🟡 | Check `pcap_datalink()` for link-layer type |
| 🟠 | Ring buffer + worker thread separation |
| 🟠 | Flow timeout / expiry |
| 🟠 | Payload entropy feature |
| 🟠 | Expand BPF filter beyond TCP |
| 🟢 | Protobuf schema + Unix socket stub (Phase 3 bridge) |
