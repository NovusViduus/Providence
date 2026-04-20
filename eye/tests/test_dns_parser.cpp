#include <gtest/gtest.h>
#include "dns_parser.h"
#include <vector>
#include <cstring>

// Helper: build a DNS query packet for a given domain and qtype
static std::vector<uint8_t> build_dns_query(const std::string& domain, uint16_t qtype, bool is_response = false) {
    std::vector<uint8_t> pkt;

    // DNS header (12 bytes)
    pkt.push_back(0x00); pkt.push_back(0x01);  // Transaction ID
    uint8_t flags_hi = is_response ? 0x80 : 0x00;  // QR bit
    pkt.push_back(flags_hi); pkt.push_back(0x00);  // Flags
    pkt.push_back(0x00); pkt.push_back(0x01);  // QDCOUNT = 1
    pkt.push_back(0x00); pkt.push_back(0x00);  // ANCOUNT
    pkt.push_back(0x00); pkt.push_back(0x00);  // NSCOUNT
    pkt.push_back(0x00); pkt.push_back(0x00);  // ARCOUNT

    // Question section: encode domain labels
    size_t pos = 0;
    while (pos < domain.size()) {
        size_t dot = domain.find('.', pos);
        if (dot == std::string::npos) dot = domain.size();
        uint8_t label_len = (uint8_t)(dot - pos);
        pkt.push_back(label_len);
        for (size_t i = pos; i < dot; i++) {
            pkt.push_back((uint8_t)domain[i]);
        }
        pos = dot + 1;
    }
    pkt.push_back(0x00);  // root label

    // QTYPE
    pkt.push_back((uint8_t)(qtype >> 8));
    pkt.push_back((uint8_t)(qtype & 0xFF));
    // QCLASS = IN (1)
    pkt.push_back(0x00); pkt.push_back(0x01);

    return pkt;
}

TEST(DnsParser, ValidAQuery) {
    auto pkt = build_dns_query("example.com", 1);
    auto result = parse_dns_query(pkt.data(), (uint32_t)pkt.size());
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->domain, "example.com");
    EXPECT_EQ(result->query_type, 1);
}

TEST(DnsParser, ResponseRejected) {
    auto pkt = build_dns_query("example.com", 1, true);
    auto result = parse_dns_query(pkt.data(), (uint32_t)pkt.size());
    EXPECT_FALSE(result.has_value());
}

TEST(DnsParser, ZeroQdcount) {
    auto pkt = build_dns_query("example.com", 1);
    // Set QDCOUNT to 0
    pkt[4] = 0x00; pkt[5] = 0x00;
    auto result = parse_dns_query(pkt.data(), (uint32_t)pkt.size());
    EXPECT_FALSE(result.has_value());
}

TEST(DnsParser, TruncatedData) {
    uint8_t data[8] = {0};
    auto result = parse_dns_query(data, 8);
    EXPECT_FALSE(result.has_value());
}

TEST(DnsParser, MultiLabelDomain) {
    auto pkt = build_dns_query("sub.domain.example.com", 1);
    auto result = parse_dns_query(pkt.data(), (uint32_t)pkt.size());
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->domain, "sub.domain.example.com");
    EXPECT_EQ(result->query_type, 1);
}

TEST(DnsParser, TxtQuery) {
    auto pkt = build_dns_query("example.com", 16);
    auto result = parse_dns_query(pkt.data(), (uint32_t)pkt.size());
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->domain, "example.com");
    EXPECT_EQ(result->query_type, 16);
}
