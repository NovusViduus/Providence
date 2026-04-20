#ifndef DNS_PARSER_H
#define DNS_PARSER_H

#include <cstdint>
#include <string>
#include <optional>

struct DnsQuery {
    std::string domain;
    uint16_t query_type;  // 1=A, 28=AAAA, 15=MX, 16=TXT, etc.
};

// Parses a DNS query from UDP payload bytes (after UDP header).
// Returns std::nullopt if the packet is not a valid DNS query.
std::optional<DnsQuery> parse_dns_query(const uint8_t* udp_payload, uint32_t payload_len);

#endif // DNS_PARSER_H
