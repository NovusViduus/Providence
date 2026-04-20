#include <gtest/gtest.h>
#include "tls_parser.h"
#include <cstring>
#include <vector>

// Helper: build a minimal valid TLS 1.2 ClientHello
static std::vector<uint8_t> build_client_hello() {
    std::vector<uint8_t> pkt;

    // --- TLS Record Layer ---
    pkt.push_back(0x16);  // content type: handshake
    pkt.push_back(0x03); pkt.push_back(0x01);  // TLS 1.0 record version
    // record length placeholder (indices 3-4)
    pkt.push_back(0x00); pkt.push_back(0x00);

    // --- Handshake Header ---
    size_t hs_start = pkt.size();
    pkt.push_back(0x01);  // handshake type: ClientHello
    // handshake length placeholder (indices 6-8)
    pkt.push_back(0x00); pkt.push_back(0x00); pkt.push_back(0x00);

    size_t ch_start = pkt.size();

    // ClientHello version: TLS 1.2
    pkt.push_back(0x03); pkt.push_back(0x03);

    // Random (32 bytes)
    for (int i = 0; i < 32; i++) pkt.push_back((uint8_t)i);

    // Session ID length: 0
    pkt.push_back(0x00);

    // Cipher suites: 2 suites (4 bytes)
    pkt.push_back(0x00); pkt.push_back(0x04);
    // GREASE value (should be filtered)
    pkt.push_back(0x0A); pkt.push_back(0x0A);
    // TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 (0xC02F)
    pkt.push_back(0xC0); pkt.push_back(0x2F);

    // Compression methods: 1 method (null)
    pkt.push_back(0x01); pkt.push_back(0x00);

    // Extensions
    size_t ext_len_pos = pkt.size();
    pkt.push_back(0x00); pkt.push_back(0x00);  // extensions length placeholder

    size_t ext_start = pkt.size();

    // Extension: supported_groups (0x000A)
    pkt.push_back(0x00); pkt.push_back(0x0A);  // type
    pkt.push_back(0x00); pkt.push_back(0x06);  // ext length: 6
    pkt.push_back(0x00); pkt.push_back(0x04);  // curves list length: 4
    pkt.push_back(0x00); pkt.push_back(0x17);  // secp256r1 (23)
    pkt.push_back(0x00); pkt.push_back(0x18);  // secp384r1 (24)

    // Extension: ec_point_formats (0x000B)
    pkt.push_back(0x00); pkt.push_back(0x0B);  // type
    pkt.push_back(0x00); pkt.push_back(0x02);  // ext length: 2
    pkt.push_back(0x01);                        // formats length: 1
    pkt.push_back(0x00);                        // uncompressed

    // Extension: server_name (0x0000) — GREASE extension type should NOT be here
    pkt.push_back(0x00); pkt.push_back(0x00);  // type: SNI
    pkt.push_back(0x00); pkt.push_back(0x00);  // ext length: 0

    size_t ext_end = pkt.size();

    // Fill in extensions length
    uint16_t ext_len = (uint16_t)(ext_end - ext_start);
    pkt[ext_len_pos] = (uint8_t)(ext_len >> 8);
    pkt[ext_len_pos + 1] = (uint8_t)(ext_len & 0xFF);

    // Fill in handshake length
    uint32_t ch_len = (uint32_t)(pkt.size() - ch_start);
    pkt[hs_start + 1] = (uint8_t)((ch_len >> 16) & 0xFF);
    pkt[hs_start + 2] = (uint8_t)((ch_len >> 8) & 0xFF);
    pkt[hs_start + 3] = (uint8_t)(ch_len & 0xFF);

    // Fill in record length
    uint16_t rec_len = (uint16_t)(pkt.size() - 5);
    pkt[3] = (uint8_t)(rec_len >> 8);
    pkt[4] = (uint8_t)(rec_len & 0xFF);

    return pkt;
}

TEST(TlsParser, ValidClientHello) {
    auto pkt = build_client_hello();
    auto result = parse_ja3(pkt.data(), (uint32_t)pkt.size());
    ASSERT_TRUE(result.has_value());

    EXPECT_EQ(result->tls_version, 0x0303);  // TLS 1.2
    EXPECT_EQ(result->ja3_hash.size(), 32u);  // MD5 hex = 32 chars

    // GREASE cipher filtered, only 0xC02F remains
    EXPECT_EQ(result->cipher_suites.size(), 1u);
    EXPECT_EQ(result->cipher_suites[0], 0xC02F);

    // 3 extensions: supported_groups, ec_point_formats, SNI
    EXPECT_EQ(result->extensions.size(), 3u);

    // Elliptic curves
    EXPECT_EQ(result->elliptic_curves.size(), 2u);
    EXPECT_EQ(result->elliptic_curves[0], 23);
    EXPECT_EQ(result->elliptic_curves[1], 24);

    // EC point formats
    EXPECT_EQ(result->ec_point_formats.size(), 1u);
    EXPECT_EQ(result->ec_point_formats[0], 0);
}

TEST(TlsParser, NonTlsPayload) {
    // HTTP GET request
    const char* http = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
    auto result = parse_ja3(reinterpret_cast<const uint8_t*>(http), (uint32_t)strlen(http));
    EXPECT_FALSE(result.has_value());
}

TEST(TlsParser, TruncatedClientHello) {
    auto pkt = build_client_hello();
    // Cut off in the middle of cipher suites
    auto result = parse_ja3(pkt.data(), 50);
    EXPECT_FALSE(result.has_value());
}

TEST(TlsParser, EmptyBuffer) {
    auto result = parse_ja3(nullptr, 0);
    EXPECT_FALSE(result.has_value());
}

TEST(TlsParser, ServerHelloNotClientHello) {
    auto pkt = build_client_hello();
    // Change handshake type from 0x01 (ClientHello) to 0x02 (ServerHello)
    pkt[5] = 0x02;
    auto result = parse_ja3(pkt.data(), (uint32_t)pkt.size());
    EXPECT_FALSE(result.has_value());
}

TEST(TlsParser, GreaseFiltered) {
    auto pkt = build_client_hello();
    auto result = parse_ja3(pkt.data(), (uint32_t)pkt.size());
    ASSERT_TRUE(result.has_value());

    // Verify no GREASE values in cipher suites
    for (uint16_t cs : result->cipher_suites) {
        EXPECT_FALSE((cs & 0x0F0F) == 0x0A0A) << "GREASE value found in cipher suites: " << cs;
    }
    // Verify no GREASE values in extensions
    for (uint16_t ext : result->extensions) {
        EXPECT_FALSE((ext & 0x0F0F) == 0x0A0A) << "GREASE value found in extensions: " << ext;
    }
}
