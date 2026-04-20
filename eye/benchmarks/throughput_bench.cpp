#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "features/flow_tracker.h"
#include "features/tls_parser.h"
#include "features/dns_parser.h"

static const int NUM_PACKETS = 100000;
static const int PKT_SIZE = 200;  // typical packet size

// Build a synthetic Ethernet + IPv4 + TCP packet with random-ish fields
static void build_synthetic_tcp(uint8_t* buf, int index) {
    std::memset(buf, 0, PKT_SIZE);

    // Ethernet header (14 bytes)
    buf[12] = 0x08; buf[13] = 0x00;  // IPv4

    // IPv4 header (20 bytes, offset 14)
    buf[14] = 0x45;  // version=4, IHL=5
    buf[14 + 8] = 64;  // TTL
    buf[14 + 9] = 6;   // TCP
    // Src IP: 10.0.x.y
    buf[26] = 10; buf[27] = 0;
    buf[28] = (uint8_t)((index >> 8) & 0xFF);
    buf[29] = (uint8_t)(index & 0xFF);
    // Dst IP: 192.168.1.x
    buf[30] = 192; buf[31] = 168; buf[32] = 1;
    buf[33] = (uint8_t)(index % 256);

    // TCP header (20 bytes, offset 34)
    uint16_t sp = 1024 + (index % 60000);
    uint16_t dp = 80 + (index % 10);
    buf[34] = (uint8_t)(sp >> 8); buf[35] = (uint8_t)(sp & 0xFF);
    buf[36] = (uint8_t)(dp >> 8); buf[37] = (uint8_t)(dp & 0xFF);
    buf[46] = 0x50;  // data offset = 5
    buf[47] = 0x10;  // ACK flag
    buf[48] = 0x10; buf[49] = 0x00;  // window = 4096

    // Payload: fill with pseudo-random bytes
    for (int i = 54; i < PKT_SIZE; i++) {
        buf[i] = (uint8_t)((index + i) * 31 & 0xFF);
    }
}

// Build a minimal TLS ClientHello for JA3 benchmarking
static std::vector<uint8_t> build_bench_client_hello() {
    std::vector<uint8_t> pkt;
    pkt.push_back(0x16);
    pkt.push_back(0x03); pkt.push_back(0x01);
    pkt.push_back(0x00); pkt.push_back(0x00);  // record length placeholder

    size_t hs_start = pkt.size();
    pkt.push_back(0x01);
    pkt.push_back(0x00); pkt.push_back(0x00); pkt.push_back(0x00);

    size_t ch_start = pkt.size();
    pkt.push_back(0x03); pkt.push_back(0x03);  // TLS 1.2
    for (int i = 0; i < 32; i++) pkt.push_back((uint8_t)i);  // random
    pkt.push_back(0x00);  // session ID len

    // 4 cipher suites
    pkt.push_back(0x00); pkt.push_back(0x08);
    pkt.push_back(0xC0); pkt.push_back(0x2F);
    pkt.push_back(0xC0); pkt.push_back(0x30);
    pkt.push_back(0xC0); pkt.push_back(0x2B);
    pkt.push_back(0xC0); pkt.push_back(0x2C);

    pkt.push_back(0x01); pkt.push_back(0x00);  // compression

    // Extensions
    size_t ext_len_pos = pkt.size();
    pkt.push_back(0x00); pkt.push_back(0x00);
    size_t ext_start = pkt.size();

    // SNI
    pkt.push_back(0x00); pkt.push_back(0x00);
    pkt.push_back(0x00); pkt.push_back(0x00);

    // supported_groups
    pkt.push_back(0x00); pkt.push_back(0x0A);
    pkt.push_back(0x00); pkt.push_back(0x04);
    pkt.push_back(0x00); pkt.push_back(0x02);
    pkt.push_back(0x00); pkt.push_back(0x17);

    // ec_point_formats
    pkt.push_back(0x00); pkt.push_back(0x0B);
    pkt.push_back(0x00); pkt.push_back(0x02);
    pkt.push_back(0x01); pkt.push_back(0x00);

    size_t ext_end = pkt.size();
    uint16_t ext_len = (uint16_t)(ext_end - ext_start);
    pkt[ext_len_pos] = (uint8_t)(ext_len >> 8);
    pkt[ext_len_pos + 1] = (uint8_t)(ext_len & 0xFF);

    uint32_t ch_len = (uint32_t)(pkt.size() - ch_start);
    pkt[hs_start + 1] = (uint8_t)((ch_len >> 16) & 0xFF);
    pkt[hs_start + 2] = (uint8_t)((ch_len >> 8) & 0xFF);
    pkt[hs_start + 3] = (uint8_t)(ch_len & 0xFF);

    uint16_t rec_len = (uint16_t)(pkt.size() - 5);
    pkt[3] = (uint8_t)(rec_len >> 8);
    pkt[4] = (uint8_t)(rec_len & 0xFF);

    return pkt;
}

// Build a DNS query for benchmarking
static std::vector<uint8_t> build_bench_dns_query() {
    std::vector<uint8_t> pkt;
    // Header
    pkt.push_back(0x00); pkt.push_back(0x01);
    pkt.push_back(0x00); pkt.push_back(0x00);
    pkt.push_back(0x00); pkt.push_back(0x01);
    pkt.push_back(0x00); pkt.push_back(0x00);
    pkt.push_back(0x00); pkt.push_back(0x00);
    pkt.push_back(0x00); pkt.push_back(0x00);
    // Question: example.com type A
    pkt.push_back(0x07);
    for (char c : std::string("example")) pkt.push_back((uint8_t)c);
    pkt.push_back(0x03);
    for (char c : std::string("com")) pkt.push_back((uint8_t)c);
    pkt.push_back(0x00);
    pkt.push_back(0x00); pkt.push_back(0x01);
    pkt.push_back(0x00); pkt.push_back(0x01);
    return pkt;
}

int main() {
    printf("=== The Eye — Throughput Benchmark ===\n\n");

    // --- Flow processing benchmark ---
    {
        std::vector<std::vector<uint8_t>> packets(NUM_PACKETS);
        for (int i = 0; i < NUM_PACKETS; i++) {
            packets[i].resize(PKT_SIZE);
            build_synthetic_tcp(packets[i].data(), i);
        }

        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < NUM_PACKETS; i++) {
            process_packet(packets[i].data(), PKT_SIZE, 1000 + i, 14);
        }
        auto end = std::chrono::high_resolution_clock::now();

        auto us = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
        double pps = (double)NUM_PACKETS / (us / 1e6);
        double mbps = (double)NUM_PACKETS * PKT_SIZE * 8.0 / us;

        printf("%-30s %10d packets  %10ld us  %12.0f pkt/s  %8.1f Mbps\n",
            "process_packet", NUM_PACKETS, (long)us, pps, mbps);
    }

    // --- JA3 parsing benchmark ---
    {
        auto ch = build_bench_client_hello();
        int ja3_count = NUM_PACKETS;

        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < ja3_count; i++) {
            parse_ja3(ch.data(), (uint32_t)ch.size());
        }
        auto end = std::chrono::high_resolution_clock::now();

        auto us = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
        double pps = (double)ja3_count / (us / 1e6);

        printf("%-30s %10d parses   %10ld us  %12.0f parse/s\n",
            "parse_ja3", ja3_count, (long)us, pps);
    }

    // --- DNS parsing benchmark ---
    {
        auto dns = build_bench_dns_query();
        int dns_count = NUM_PACKETS;

        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < dns_count; i++) {
            parse_dns_query(dns.data(), (uint32_t)dns.size());
        }
        auto end = std::chrono::high_resolution_clock::now();

        auto us = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
        double pps = (double)dns_count / (us / 1e6);

        printf("%-30s %10d parses   %10ld us  %12.0f parse/s\n",
            "parse_dns_query", dns_count, (long)us, pps);
    }

    printf("\nDone.\n");
    return 0;
}
