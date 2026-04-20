#include "dns_parser.h"

#include <cstring>

static uint16_t read_u16(const uint8_t* p) {
    return (uint16_t)((uint8_t)p[0] << 8) | (uint8_t)p[1];
}

std::optional<DnsQuery> parse_dns_query(const uint8_t* data, uint32_t len) {
    // DNS header is 12 bytes minimum
    if (len < 12) return std::nullopt;

    // Check QR bit — must be 0 (query)
    if (data[2] & 0x80) return std::nullopt;

    uint16_t qdcount = read_u16(data + 4);
    if (qdcount == 0) return std::nullopt;

    // Parse first question section
    uint32_t pos = 12;
    std::string domain;

    while (pos < len) {
        uint8_t label_len = data[pos];
        if (label_len == 0) {
            pos++;
            break;
        }
        // Pointer compression not expected in queries, but guard against it
        if ((label_len & 0xC0) == 0xC0) return std::nullopt;
        pos++;
        if (pos + label_len > len) return std::nullopt;
        if (!domain.empty()) domain += ".";
        domain.append(reinterpret_cast<const char*>(data + pos), label_len);
        pos += label_len;
    }

    // QTYPE (2 bytes) + QCLASS (2 bytes)
    if (pos + 4 > len) return std::nullopt;
    uint16_t qtype = read_u16(data + pos);

    DnsQuery result;
    result.domain = domain;
    result.query_type = qtype;
    return result;
}
