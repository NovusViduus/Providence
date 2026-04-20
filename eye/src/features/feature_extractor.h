#ifndef FEATURES_H
#define FEATURES_H

#include <cstdint>
#include <string>

// Canonical feature vector for the ML pipeline.
// Populated from FlowStats at export time.
struct FeatureVector {
    // Network layer
    std::string src_ip;
    std::string dst_ip;
    uint16_t src_port = 0;
    uint16_t dst_port = 0;
    uint8_t protocol = 0;
    uint8_t ttl = 0;

    // Transport layer — flag counts
    int syn_count = 0;
    int ack_count = 0;
    int fin_count = 0;
    int rst_count = 0;
    int psh_count = 0;
    int urg_count = 0;

    // Transport layer — window sizes
    uint16_t window_size_min = 0xFFFF;
    uint16_t window_size_max = 0;
    double window_size_mean = 0.0;

    // Flow-level timing
    long duration = 0;
    double packets_per_sec = 0.0;
    double bytes_per_sec = 0.0;
    double inter_arrival_mean = 0.0;
    double inter_arrival_std = 0.0;
    long inter_arrival_min = 0;
    long inter_arrival_max = 0;

    // Directional counts
    int packet_count = 0;
    int total_bytes = 0;
    int packet_count_fwd = 0;
    int packet_count_bwd = 0;
    int bytes_fwd = 0;
    int bytes_bwd = 0;

    // Payload analysis
    double payload_entropy_mean = 0.0;
    uint32_t payload_size_min = 0xFFFFFFFF;
    uint32_t payload_size_max = 0;
    double payload_size_mean = 0.0;
    int zero_payload_count = 0;

    // TLS
    std::string ja3_hash;
    bool ja3_seen = false;
    int cipher_suite_count = 0;
    int extension_count = 0;

    // DNS
    int dns_query_count = 0;
    int dns_unique_domains = 0;
    double dns_txt_query_ratio = 0.0;
};

#endif // FEATURES_H
