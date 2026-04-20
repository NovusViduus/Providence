#ifndef TLS_PARSER_H
#define TLS_PARSER_H

#include <cstdint>
#include <string>
#include <vector>
#include <optional>

struct JA3Result {
    uint16_t tls_version;
    std::vector<uint16_t> cipher_suites;
    std::vector<uint16_t> extensions;
    std::vector<uint16_t> elliptic_curves;
    std::vector<uint8_t> ec_point_formats;
    std::string ja3_string;  // raw concatenation before hashing
    std::string ja3_hash;    // MD5 hex digest
};

// Attempts to parse a TLS ClientHello from TCP payload bytes.
// Returns std::nullopt if the payload is not a ClientHello.
std::optional<JA3Result> parse_ja3(const uint8_t* tcp_payload, uint32_t payload_len);

#endif // TLS_PARSER_H
