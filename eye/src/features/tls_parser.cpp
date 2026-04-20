#include "tls_parser.h"

#include <openssl/md5.h>
#include <sstream>
#include <iomanip>
#include <cstring>

// GREASE values per RFC 8701
static bool is_grease(uint16_t val) {
    return (val & 0x0F0F) == 0x0A0A;
}

static uint16_t read_u16(const uint8_t* p) {
    return (uint16_t)((uint8_t)p[0] << 8) | (uint8_t)p[1];
}

static std::string md5_hex(const std::string& input) {
    unsigned char digest[MD5_DIGEST_LENGTH];
    MD5(reinterpret_cast<const unsigned char*>(input.data()), input.size(), digest);
    std::ostringstream ss;
    for (int i = 0; i < MD5_DIGEST_LENGTH; i++) {
        ss << std::hex << std::setfill('0') << std::setw(2) << (int)digest[i];
    }
    return ss.str();
}

static std::string join_u16(const std::vector<uint16_t>& v) {
    std::string result;
    for (size_t i = 0; i < v.size(); i++) {
        if (i > 0) result += "-";
        result += std::to_string(v[i]);
    }
    return result;
}

static std::string join_u8(const std::vector<uint8_t>& v) {
    std::string result;
    for (size_t i = 0; i < v.size(); i++) {
        if (i > 0) result += "-";
        result += std::to_string(v[i]);
    }
    return result;
}

std::optional<JA3Result> parse_ja3(const uint8_t* data, uint32_t len) {
    // Minimum: TLS record header (5) + handshake header (4) + ClientHello fixed fields (38)
    if (len < 47) return std::nullopt;

    // TLS record layer: content type 0x16 (handshake)
    if (data[0] != 0x16) return std::nullopt;

    uint16_t record_len = read_u16(data + 3);
    if (record_len + 5 > len) return std::nullopt;

    // Handshake header: type 0x01 (ClientHello)
    const uint8_t* hs = data + 5;
    uint32_t hs_len = record_len;
    if (hs[0] != 0x01) return std::nullopt;

    // Handshake length (3 bytes)
    uint32_t ch_len = ((uint32_t)hs[1] << 16) | ((uint32_t)hs[2] << 8) | hs[3];
    if (ch_len + 4 > hs_len) return std::nullopt;

    const uint8_t* ch = hs + 4;
    uint32_t ch_remaining = ch_len;
    uint32_t pos = 0;

    JA3Result result;

    // ClientHello version (2 bytes)
    if (pos + 2 > ch_remaining) return std::nullopt;
    result.tls_version = read_u16(ch + pos);
    pos += 2;

    // Random (32 bytes)
    pos += 32;
    if (pos > ch_remaining) return std::nullopt;

    // Session ID
    if (pos + 1 > ch_remaining) return std::nullopt;
    uint8_t session_id_len = ch[pos];
    pos += 1 + session_id_len;
    if (pos > ch_remaining) return std::nullopt;

    // Cipher suites
    if (pos + 2 > ch_remaining) return std::nullopt;
    uint16_t cs_len = read_u16(ch + pos);
    pos += 2;
    if (pos + cs_len > ch_remaining) return std::nullopt;
    for (uint16_t i = 0; i < cs_len; i += 2) {
        uint16_t cs = read_u16(ch + pos + i);
        if (!is_grease(cs)) {
            result.cipher_suites.push_back(cs);
        }
    }
    pos += cs_len;

    // Compression methods
    if (pos + 1 > ch_remaining) return std::nullopt;
    uint8_t comp_len = ch[pos];
    pos += 1 + comp_len;
    if (pos > ch_remaining) return std::nullopt;

    // Extensions
    if (pos + 2 <= ch_remaining) {
        uint16_t ext_total_len = read_u16(ch + pos);
        pos += 2;
        uint32_t ext_end = pos + ext_total_len;
        if (ext_end > ch_remaining) ext_end = ch_remaining;

        while (pos + 4 <= ext_end) {
            uint16_t ext_type = read_u16(ch + pos);
            uint16_t ext_len = read_u16(ch + pos + 2);
            pos += 4;

            if (!is_grease(ext_type)) {
                result.extensions.push_back(ext_type);

                // Supported groups (elliptic curves) — extension 0x000A
                if (ext_type == 0x000A && ext_len >= 2 && pos + ext_len <= ext_end) {
                    uint16_t curves_len = read_u16(ch + pos);
                    for (uint16_t i = 0; i < curves_len && i + 1 < ext_len; i += 2) {
                        uint16_t curve = read_u16(ch + pos + 2 + i);
                        if (!is_grease(curve)) {
                            result.elliptic_curves.push_back(curve);
                        }
                    }
                }

                // EC point formats — extension 0x000B
                if (ext_type == 0x000B && ext_len >= 1 && pos + ext_len <= ext_end) {
                    uint8_t fmt_len = ch[pos];
                    for (uint8_t i = 0; i < fmt_len && i + 1 < ext_len; i++) {
                        result.ec_point_formats.push_back(ch[pos + 1 + i]);
                    }
                }
            }

            pos += ext_len;
        }
    }

    // Build JA3 string: TLSVersion,Ciphers,Extensions,EllipticCurves,ECPointFormats
    std::string ja3_str;
    ja3_str += std::to_string(result.tls_version);
    ja3_str += ",";
    ja3_str += join_u16(result.cipher_suites);
    ja3_str += ",";
    ja3_str += join_u16(result.extensions);
    ja3_str += ",";
    ja3_str += join_u16(result.elliptic_curves);
    ja3_str += ",";
    ja3_str += join_u8(result.ec_point_formats);

    result.ja3_string = ja3_str;
    result.ja3_hash = md5_hex(ja3_str);

    return result;
}
