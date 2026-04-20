#ifndef FLOW_TABLE_H
#define FLOW_TABLE_H

#include <cstdint>
#include <string>
#include <vector>
#include <functional>

void process_packet(const uint8_t* pkt, uint32_t len, long tv_sec, int link_hdr_len);
void process_dns_packet(const uint8_t* pkt, uint32_t len, long tv_sec, int link_hdr_len);
void export_json();
void print_summary();
int get_packet_count();
size_t get_flow_count();

// Flow completion info passed to the callback
struct CompletedFlow {
    std::string flow_key;
    std::string src_ip;
    std::string dst_ip;
    uint16_t src_port;
    uint16_t dst_port;
    int packet_count;
    int total_bytes;
    int syn_count;
    int ack_count;
    int fin_count;
    int rst_count;
    int psh_count;
    int urg_count;
    int packet_count_fwd;
    int packet_count_bwd;
    int bytes_fwd;
    int bytes_bwd;
    uint16_t window_size_min;
    uint16_t window_size_max;
    double window_size_mean;
    double payload_entropy_mean;
    uint32_t payload_size_min;
    uint32_t payload_size_max;
    double payload_size_mean;
    int zero_payload_count;
    uint8_t ttl;
    std::string ja3_hash;
    bool ja3_seen;
    int cipher_suite_count;
    int extension_count;
    double inter_arrival_mean;
    double inter_arrival_std;
    long inter_arrival_min;
    long inter_arrival_max;
    long duration;
    double packets_per_sec;
    double bytes_per_sec;
    double syn_ack_ratio;
    float flow_duration_secs;
};

// Set callback for completed flows
using FlowCompleteCallback = std::function<void(const CompletedFlow&)>;
void set_flow_complete_callback(FlowCompleteCallback cb);

// Check for completed flows: FIN+ACK both directions, RST, or inactivity timeout
void check_completed_flows(long current_time, long timeout_seconds = 30);

// Classify and evict all remaining flows (called at shutdown)
void flush_all_flows(long current_time);

#endif // FLOW_TABLE_H
