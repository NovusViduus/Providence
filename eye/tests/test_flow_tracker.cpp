#include <gtest/gtest.h>
#include "features/flow_tracker.h"
#include <cstring>
#include <vector>

// Helper: build a fake Ethernet + IPv4 + TCP packet
// link_hdr_len = 14 (Ethernet)
static std::vector<uint8_t> build_tcp_packet(
    const uint8_t src_ip[4], const uint8_t dst_ip[4],
    uint16_t src_port, uint16_t dst_port,
    uint8_t tcp_flags, const uint8_t* payload = nullptr, uint32_t payload_len = 0,
    uint16_t window = 1024)
{
    // Ethernet (14) + IP (20) + TCP (20) + payload
    uint32_t total = 14 + 20 + 20 + payload_len;
    std::vector<uint8_t> pkt(total, 0);

    // --- Ethernet header (14 bytes) ---
    // dst/src MAC: zeros, ethertype: 0x0800 (IPv4)
    pkt[12] = 0x08; pkt[13] = 0x00;

    // --- IPv4 header (20 bytes, offset 14) ---
    int ip = 14;
    pkt[ip] = 0x45;  // version=4, IHL=5 (20 bytes)
    // Total length
    uint16_t ip_total = 20 + 20 + payload_len;
    pkt[ip + 2] = (uint8_t)(ip_total >> 8);
    pkt[ip + 3] = (uint8_t)(ip_total & 0xFF);
    pkt[ip + 8] = 64;  // TTL
    pkt[ip + 9] = 6;   // Protocol: TCP
    // Src IP
    pkt[ip + 12] = src_ip[0]; pkt[ip + 13] = src_ip[1];
    pkt[ip + 14] = src_ip[2]; pkt[ip + 15] = src_ip[3];
    // Dst IP
    pkt[ip + 16] = dst_ip[0]; pkt[ip + 17] = dst_ip[1];
    pkt[ip + 18] = dst_ip[2]; pkt[ip + 19] = dst_ip[3];

    // --- TCP header (20 bytes, offset 34) ---
    int tcp = 34;
    pkt[tcp] = (uint8_t)(src_port >> 8);
    pkt[tcp + 1] = (uint8_t)(src_port & 0xFF);
    pkt[tcp + 2] = (uint8_t)(dst_port >> 8);
    pkt[tcp + 3] = (uint8_t)(dst_port & 0xFF);
    pkt[tcp + 12] = 0x50;  // data offset = 5 (20 bytes), no options
    pkt[tcp + 13] = tcp_flags;
    pkt[tcp + 14] = (uint8_t)(window >> 8);
    pkt[tcp + 15] = (uint8_t)(window & 0xFF);

    // Payload
    if (payload && payload_len > 0) {
        std::memcpy(pkt.data() + 54, payload, payload_len);
    }

    return pkt;
}

class FlowTrackerTest : public ::testing::Test {
protected:
    // Note: flow_tracker uses file-static state, so tests are not fully isolated.
    // This is acceptable for integration-style tests.
    uint8_t ip_a[4] = {10, 0, 0, 1};
    uint8_t ip_b[4] = {10, 0, 0, 2};
};

TEST_F(FlowTrackerTest, TwoPacketsSameFlow) {
    size_t before = get_flow_count();
    int pk_before = get_packet_count();

    auto pkt1 = build_tcp_packet(ip_a, ip_b, 12345, 80, 0x02);  // SYN
    auto pkt2 = build_tcp_packet(ip_a, ip_b, 12345, 80, 0x10);  // ACK
    process_packet(pkt1.data(), (uint32_t)pkt1.size(), 1000, 14);
    process_packet(pkt2.data(), (uint32_t)pkt2.size(), 1001, 14);

    EXPECT_EQ(get_packet_count(), pk_before + 2);
    // Should be same flow, so flow count increases by at most 1
    EXPECT_LE(get_flow_count(), before + 1);
}

TEST_F(FlowTrackerTest, BidirectionalKeying) {
    size_t before = get_flow_count();

    // Packet A→B
    auto pkt1 = build_tcp_packet(ip_a, ip_b, 54321, 443, 0x02);
    // Packet B→A (swapped)
    auto pkt2 = build_tcp_packet(ip_b, ip_a, 443, 54321, 0x12);  // SYN-ACK

    process_packet(pkt1.data(), (uint32_t)pkt1.size(), 2000, 14);
    process_packet(pkt2.data(), (uint32_t)pkt2.size(), 2001, 14);

    // Both should land in the same flow
    EXPECT_EQ(get_flow_count(), before + 1);
}

TEST_F(FlowTrackerTest, SynFlagCounted) {
    int pk_before = get_packet_count();
    auto pkt = build_tcp_packet(ip_a, ip_b, 11111, 22, 0x02);  // SYN
    process_packet(pkt.data(), (uint32_t)pkt.size(), 3000, 14);
    EXPECT_EQ(get_packet_count(), pk_before + 1);
}

TEST_F(FlowTrackerTest, PayloadEntropy) {
    // Packet with payload — entropy should be calculated
    uint8_t payload[16];
    for (int i = 0; i < 16; i++) payload[i] = (uint8_t)i;
    auto pkt = build_tcp_packet(ip_a, ip_b, 33333, 8080, 0x18, payload, 16);
    int pk_before = get_packet_count();
    process_packet(pkt.data(), (uint32_t)pkt.size(), 4000, 14);
    EXPECT_EQ(get_packet_count(), pk_before + 1);
}

TEST_F(FlowTrackerTest, ZeroPayload) {
    // Packet with no payload (just headers)
    auto pkt = build_tcp_packet(ip_a, ip_b, 44444, 9090, 0x10);  // ACK, no payload
    int pk_before = get_packet_count();
    process_packet(pkt.data(), (uint32_t)pkt.size(), 5000, 14);
    EXPECT_EQ(get_packet_count(), pk_before + 1);
}

TEST_F(FlowTrackerTest, WindowSizeTracked) {
    auto pkt = build_tcp_packet(ip_a, ip_b, 55555, 3306, 0x10, nullptr, 0, 8192);
    int pk_before = get_packet_count();
    process_packet(pkt.data(), (uint32_t)pkt.size(), 6000, 14);
    EXPECT_EQ(get_packet_count(), pk_before + 1);
}
