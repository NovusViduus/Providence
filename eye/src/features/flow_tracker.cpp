#include "flow_tracker.h"
#include "entropy.h"
#include "tls_parser.h"
#include "dns_parser.h"

#include <unordered_map>
#include <unordered_set>
#include <string>
#include <vector>
#include <optional>
#include <fstream>
#include <iostream>
#include <iomanip>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <functional>

struct FlowStats {
    int packet_count = 0;
    int total_bytes = 0;
    int syn_count = 0;
    int ack_count = 0;
    int fin_count = 0;
    int rst_count = 0;
    int psh_count = 0;
    int urg_count = 0;
    std::optional<long> first_seen;
    long last_seen = 0;

    // Directional counts — "forward" = direction of first packet seen
    std::string fwd_side;  // the side_a or side_b that appeared first
    int packet_count_fwd = 0;
    int packet_count_bwd = 0;
    int bytes_fwd = 0;
    int bytes_bwd = 0;

    // Window sizes
    uint16_t window_size_min = 0xFFFF;
    uint16_t window_size_max = 0;
    uint64_t window_size_sum = 0;

    // Inter-arrival times
    std::vector<long> timestamps;

    // Payload analysis
    double entropy_sum = 0.0;
    int entropy_count = 0;
    uint32_t payload_size_min = 0xFFFFFFFF;
    uint32_t payload_size_max = 0;
    uint64_t payload_size_sum = 0;
    int payload_count = 0;
    int zero_payload_count = 0;

    // TTL (from first packet)
    uint8_t ttl = 0;

    // TLS / JA3
    std::string ja3_hash;
    bool ja3_seen = false;
    int cipher_suite_count = 0;
    int extension_count = 0;
};

// DNS tracking — per source IP
struct DnsStats {
    int query_count = 0;
    std::unordered_set<std::string> unique_domains;
    int txt_query_count = 0;
};

static std::unordered_map<std::string, FlowStats> flows;
static std::unordered_map<std::string, DnsStats> dns_stats;  // keyed by src_ip
static int pk_count = 0;

void process_packet(const uint8_t* pkt, uint32_t len, long tv_sec, int link_hdr_len) {
    int offset = link_hdr_len;

    uint8_t ihl = (pkt[offset] & 0x0F) * 4;
    uint8_t ttl = pkt[offset + 8];

    char src_buf[16], dst_buf[16];
    snprintf(src_buf, sizeof(src_buf), "%d.%d.%d.%d",
        (uint8_t)pkt[offset + 12], (uint8_t)pkt[offset + 13],
        (uint8_t)pkt[offset + 14], (uint8_t)pkt[offset + 15]);
    std::string src_ip(src_buf);
    snprintf(dst_buf, sizeof(dst_buf), "%d.%d.%d.%d",
        (uint8_t)pkt[offset + 16], (uint8_t)pkt[offset + 17],
        (uint8_t)pkt[offset + 18], (uint8_t)pkt[offset + 19]);
    std::string dst_ip(dst_buf);

    int tcp_offset = offset + ihl;
    uint16_t src_port = (uint16_t)((uint8_t)pkt[tcp_offset] << 8) | (uint8_t)pkt[tcp_offset + 1];
    uint16_t dst_port = (uint16_t)((uint8_t)pkt[tcp_offset + 2] << 8) | (uint8_t)pkt[tcp_offset + 3];

    std::string side_a = src_ip + ":" + std::to_string(src_port);
    std::string side_b = dst_ip + ":" + std::to_string(dst_port);
    std::string key;
    bool is_forward;
    if (side_a < side_b) {
        key = side_a + " <-> " + side_b;
        is_forward = true;
    } else {
        key = side_b + " <-> " + side_a;
        is_forward = false;
    }

    FlowStats& flow = flows[key];

    // Set forward direction on first packet
    if (flow.packet_count == 0) {
        flow.fwd_side = side_a;
        flow.ttl = ttl;
    }
    // Determine direction relative to first packet
    bool pkt_is_fwd = (side_a == flow.fwd_side);

    uint8_t flags = pkt[tcp_offset + 13];
    flow.packet_count++;
    flow.total_bytes += len;
    if (flags & 0x02) flow.syn_count++;
    if (flags & 0x10) flow.ack_count++;
    if (flags & 0x01) flow.fin_count++;
    if (flags & 0x04) flow.rst_count++;
    if (flags & 0x08) flow.psh_count++;
    if (flags & 0x20) flow.urg_count++;

    // Directional counts
    if (pkt_is_fwd) {
        flow.packet_count_fwd++;
        flow.bytes_fwd += len;
    } else {
        flow.packet_count_bwd++;
        flow.bytes_bwd += len;
    }

    // Window size (TCP header bytes 14-15 from tcp_offset)
    uint16_t window = (uint16_t)((uint8_t)pkt[tcp_offset + 14] << 8) | (uint8_t)pkt[tcp_offset + 15];
    if (window < flow.window_size_min) flow.window_size_min = window;
    if (window > flow.window_size_max) flow.window_size_max = window;
    flow.window_size_sum += window;

    // Timestamps for inter-arrival
    flow.timestamps.push_back(tv_sec);

    if (!flow.first_seen.has_value()) flow.first_seen = tv_sec;
    flow.last_seen = tv_sec;

    // TCP payload: data offset field is upper 4 bits of byte 12 from tcp_offset
    uint8_t tcp_hdr_len = ((pkt[tcp_offset + 12] >> 4) & 0x0F) * 4;
    int payload_start = tcp_offset + tcp_hdr_len;
    int payload_len = (int)len - payload_start;
    if (payload_len < 0) payload_len = 0;

    if (payload_len == 0) {
        flow.zero_payload_count++;
    } else {
        uint32_t plen = (uint32_t)payload_len;
        if (plen < flow.payload_size_min) flow.payload_size_min = plen;
        if (plen > flow.payload_size_max) flow.payload_size_max = plen;
        flow.payload_size_sum += plen;
        flow.payload_count++;

        // Entropy
        double ent = shannon_entropy(pkt + payload_start, plen);
        flow.entropy_sum += ent;
        flow.entropy_count++;

        // TLS ClientHello detection (only if we haven't seen one yet)
        if (!flow.ja3_seen) {
            auto ja3 = parse_ja3(pkt + payload_start, plen);
            if (ja3.has_value()) {
                flow.ja3_seen = true;
                flow.ja3_hash = ja3->ja3_hash;
                flow.cipher_suite_count = (int)ja3->cipher_suites.size();
                flow.extension_count = (int)ja3->extensions.size();
            }
        }
    }

    pk_count++;
}

void process_dns_packet(const uint8_t* pkt, uint32_t len, long tv_sec, int link_hdr_len) {
    int offset = link_hdr_len;
    uint8_t ihl = (pkt[offset] & 0x0F) * 4;

    char src_buf[16];
    snprintf(src_buf, sizeof(src_buf), "%d.%d.%d.%d",
        (uint8_t)pkt[offset + 12], (uint8_t)pkt[offset + 13],
        (uint8_t)pkt[offset + 14], (uint8_t)pkt[offset + 15]);
    std::string src_ip(src_buf);

    // UDP header is 8 bytes, payload starts after
    int udp_offset = offset + ihl;
    int dns_offset = udp_offset + 8;
    int dns_len = (int)len - dns_offset;
    if (dns_len < 12) return;

    auto query = parse_dns_query(pkt + dns_offset, (uint32_t)dns_len);
    if (!query.has_value()) return;

    DnsStats& ds = dns_stats[src_ip];
    ds.query_count++;
    ds.unique_domains.insert(query->domain);
    if (query->query_type == 16) {  // TXT
        ds.txt_query_count++;
    }

    pk_count++;
}

// Helper: compute inter-arrival stats from sorted timestamps
static void compute_inter_arrival(const std::vector<long>& ts,
    double& mean, double& stddev, long& ia_min, long& ia_max)
{
    mean = 0; stddev = 0; ia_min = 0; ia_max = 0;
    if (ts.size() < 2) return;

    std::vector<long> deltas;
    deltas.reserve(ts.size() - 1);
    for (size_t i = 1; i < ts.size(); i++) {
        deltas.push_back(ts[i] - ts[i - 1]);
    }

    ia_min = *std::min_element(deltas.begin(), deltas.end());
    ia_max = *std::max_element(deltas.begin(), deltas.end());
    double sum = std::accumulate(deltas.begin(), deltas.end(), 0.0);
    mean = sum / deltas.size();

    double sq_sum = 0;
    for (long d : deltas) {
        double diff = d - mean;
        sq_sum += diff * diff;
    }
    stddev = std::sqrt(sq_sum / deltas.size());
}

void export_json() {
    std::ofstream jf("flow_export.json");
    if (!jf.is_open()) {
        std::cerr << "Failed to create JSON file." << std::endl;
        return;
    }

    jf << "[\n";
    size_t count = 0;
    for (const auto& [key, s] : flows) {
        long duration = s.first_seen.has_value() ? s.last_seen - s.first_seen.value() : 0;
        double pps = duration > 0 ? (double)s.packet_count / duration : 0;
        double bps = duration > 0 ? (double)s.total_bytes / duration : 0;
        double syn_ack = s.ack_count > 0 ? (double)s.syn_count / s.ack_count : 0;
        double win_mean = s.packet_count > 0 ? (double)s.window_size_sum / s.packet_count : 0;
        double entropy_mean = s.entropy_count > 0 ? s.entropy_sum / s.entropy_count : 0;
        double payload_mean = s.payload_count > 0 ? (double)s.payload_size_sum / s.payload_count : 0;

        double ia_mean = 0, ia_std = 0;
        long ia_min = 0, ia_max = 0;
        compute_inter_arrival(s.timestamps, ia_mean, ia_std, ia_min, ia_max);

        jf << "  {\n";
        jf << "    \"flow\": \"" << key << "\",\n";
        jf << "    \"packets\": " << s.packet_count << ",\n";
        jf << "    \"bytes\": " << s.total_bytes << ",\n";
        jf << "    \"ttl\": " << (int)s.ttl << ",\n";
        jf << "    \"syn\": " << s.syn_count << ",\n";
        jf << "    \"ack\": " << s.ack_count << ",\n";
        jf << "    \"fin\": " << s.fin_count << ",\n";
        jf << "    \"rst\": " << s.rst_count << ",\n";
        jf << "    \"psh\": " << s.psh_count << ",\n";
        jf << "    \"urg\": " << s.urg_count << ",\n";
        jf << "    \"packets_fwd\": " << s.packet_count_fwd << ",\n";
        jf << "    \"packets_bwd\": " << s.packet_count_bwd << ",\n";
        jf << "    \"bytes_fwd\": " << s.bytes_fwd << ",\n";
        jf << "    \"bytes_bwd\": " << s.bytes_bwd << ",\n";
        jf << "    \"window_size_min\": " << s.window_size_min << ",\n";
        jf << "    \"window_size_max\": " << s.window_size_max << ",\n";
        jf << "    \"window_size_mean\": " << std::fixed << std::setprecision(1) << win_mean << ",\n";
        jf << "    \"duration\": " << duration << ",\n";
        jf << "    \"pps\": " << std::fixed << std::setprecision(1) << pps << ",\n";
        jf << "    \"bps\": " << std::fixed << std::setprecision(1) << bps << ",\n";
        jf << "    \"syn_ack_ratio\": " << std::fixed << std::setprecision(2) << syn_ack << ",\n";
        jf << "    \"inter_arrival_mean\": " << std::fixed << std::setprecision(3) << ia_mean << ",\n";
        jf << "    \"inter_arrival_std\": " << std::fixed << std::setprecision(3) << ia_std << ",\n";
        jf << "    \"inter_arrival_min\": " << ia_min << ",\n";
        jf << "    \"inter_arrival_max\": " << ia_max << ",\n";
        jf << "    \"payload_entropy_mean\": " << std::fixed << std::setprecision(3) << entropy_mean << ",\n";
        jf << "    \"payload_size_min\": " << (s.payload_count > 0 ? s.payload_size_min : 0) << ",\n";
        jf << "    \"payload_size_max\": " << s.payload_size_max << ",\n";
        jf << "    \"payload_size_mean\": " << std::fixed << std::setprecision(1) << payload_mean << ",\n";
        jf << "    \"zero_payload_count\": " << s.zero_payload_count << ",\n";
        jf << "    \"ja3_seen\": " << (s.ja3_seen ? "true" : "false") << ",\n";
        jf << "    \"ja3_hash\": \"" << s.ja3_hash << "\",\n";
        jf << "    \"cipher_suite_count\": " << s.cipher_suite_count << ",\n";
        jf << "    \"extension_count\": " << s.extension_count << "\n";

        if (++count < flows.size()) {
            jf << "  },\n";
        } else {
            jf << "  }\n";
        }
    }

    // Append DNS stats as a separate section
    if (!dns_stats.empty()) {
        // If we had flows, we need to rewind the closing and add a comma
        // Instead, write DNS as a separate file
    }

    jf << "]";
    jf.close();

    // DNS stats to separate file
    if (!dns_stats.empty()) {
        std::ofstream df("dns_export.json");
        if (df.is_open()) {
            df << "[\n";
            size_t dc = 0;
            for (const auto& [ip, ds] : dns_stats) {
                double txt_ratio = ds.query_count > 0 ? (double)ds.txt_query_count / ds.query_count : 0;
                df << "  {\n";
                df << "    \"src_ip\": \"" << ip << "\",\n";
                df << "    \"query_count\": " << ds.query_count << ",\n";
                df << "    \"unique_domains\": " << ds.unique_domains.size() << ",\n";
                df << "    \"txt_query_ratio\": " << std::fixed << std::setprecision(3) << txt_ratio << "\n";
                if (++dc < dns_stats.size()) {
                    df << "  },\n";
                } else {
                    df << "  }\n";
                }
            }
            df << "]";
            df.close();
            printf("DNS data exported to dns_export.json\n");
        }
    }

    printf("\nData exported to flow_export.json\n");
}

void print_summary() {
    printf("\n=== The Eye — Flow Summary ===\n");
    printf("Total packets captured: %d\n", pk_count);
    printf("Unique flows: %zu\n", flows.size());
    if (!dns_stats.empty()) {
        int total_dns = 0;
        for (const auto& [_, ds] : dns_stats) total_dns += ds.query_count;
        printf("DNS queries: %d from %zu sources\n", total_dns, dns_stats.size());
    }
    printf("\n");

    printf("%-42s %5s %7s %3s %3s %3s %3s %3s %3s %5s %5s %6s %5s %5s %6s %5s\n",
       "Flow", "Pkts", "Bytes", "SYN", "ACK", "FIN", "RST", "PSH", "URG",
       "Fwd", "Bwd", "Dur(s)", "Pkt/s", "Ent", "WinAvg", "JA3");
    printf("──────────────────────────────────────────────────────────────────────────"
           "──────────────────────────────────────────────────────────────────\n");

    for (const auto& [key, s] : flows) {
        long duration = s.first_seen.has_value() ? s.last_seen - s.first_seen.value() : 0;
        double pps = duration > 0 ? (double)s.packet_count / duration : 0;
        double entropy_mean = s.entropy_count > 0 ? s.entropy_sum / s.entropy_count : 0;
        double win_mean = s.packet_count > 0 ? (double)s.window_size_sum / s.packet_count : 0;

        printf("%-42s %5d %7d %3d %3d %3d %3d %3d %3d %5d %5d %6ld %5.1f %5.2f %6.0f %5s\n",
            key.c_str(),
            s.packet_count, s.total_bytes,
            s.syn_count, s.ack_count, s.fin_count, s.rst_count, s.psh_count, s.urg_count,
            s.packet_count_fwd, s.packet_count_bwd,
            duration, pps, entropy_mean, win_mean,
            s.ja3_seen ? "yes" : "—");
    }
}

int get_packet_count() { return pk_count; }
size_t get_flow_count() { return flows.size(); }


static FlowCompleteCallback g_flow_complete_cb;

void set_flow_complete_callback(FlowCompleteCallback cb) {
    g_flow_complete_cb = std::move(cb);
}

static CompletedFlow build_completed_flow(const std::string& key, const FlowStats& s) {
    CompletedFlow cf;
    cf.flow_key = key;

    // Parse IPs and ports from flow key "ip:port <-> ip:port"
    auto arrow = key.find(" <-> ");
    if (arrow != std::string::npos) {
        auto left = key.substr(0, arrow);
        auto right = key.substr(arrow + 5);
        auto lcolon = left.rfind(':');
        auto rcolon = right.rfind(':');
        if (lcolon != std::string::npos) {
            cf.src_ip = left.substr(0, lcolon);
            cf.src_port = (uint16_t)std::stoi(left.substr(lcolon + 1));
        }
        if (rcolon != std::string::npos) {
            cf.dst_ip = right.substr(0, rcolon);
            cf.dst_port = (uint16_t)std::stoi(right.substr(rcolon + 1));
        }
    }

    cf.packet_count = s.packet_count;
    cf.total_bytes = s.total_bytes;
    cf.syn_count = s.syn_count;
    cf.ack_count = s.ack_count;
    cf.fin_count = s.fin_count;
    cf.rst_count = s.rst_count;
    cf.psh_count = s.psh_count;
    cf.urg_count = s.urg_count;
    cf.packet_count_fwd = s.packet_count_fwd;
    cf.packet_count_bwd = s.packet_count_bwd;
    cf.bytes_fwd = s.bytes_fwd;
    cf.bytes_bwd = s.bytes_bwd;
    cf.window_size_min = s.window_size_min;
    cf.window_size_max = s.window_size_max;
    cf.window_size_mean = s.packet_count > 0 ? (double)s.window_size_sum / s.packet_count : 0;
    cf.payload_entropy_mean = s.entropy_count > 0 ? s.entropy_sum / s.entropy_count : 0;
    cf.payload_size_min = s.payload_count > 0 ? s.payload_size_min : 0;
    cf.payload_size_max = s.payload_size_max;
    cf.payload_size_mean = s.payload_count > 0 ? (double)s.payload_size_sum / s.payload_count : 0;
    cf.zero_payload_count = s.zero_payload_count;
    cf.ttl = s.ttl;
    cf.ja3_hash = s.ja3_hash;
    cf.ja3_seen = s.ja3_seen;
    cf.cipher_suite_count = s.cipher_suite_count;
    cf.extension_count = s.extension_count;

    long duration = s.first_seen.has_value() ? s.last_seen - s.first_seen.value() : 0;
    cf.duration = duration;
    cf.flow_duration_secs = (float)duration;
    cf.packets_per_sec = duration > 0 ? (double)s.packet_count / duration : 0;
    cf.bytes_per_sec = duration > 0 ? (double)s.total_bytes / duration : 0;
    cf.syn_ack_ratio = s.ack_count > 0 ? (double)s.syn_count / s.ack_count : 0;

    // Inter-arrival stats
    cf.inter_arrival_mean = 0;
    cf.inter_arrival_std = 0;
    cf.inter_arrival_min = 0;
    cf.inter_arrival_max = 0;
    if (s.timestamps.size() >= 2) {
        double ia_mean, ia_std;
        long ia_min, ia_max;
        compute_inter_arrival(s.timestamps, ia_mean, ia_std, ia_min, ia_max);
        cf.inter_arrival_mean = ia_mean;
        cf.inter_arrival_std = ia_std;
        cf.inter_arrival_min = ia_min;
        cf.inter_arrival_max = ia_max;
    }

    return cf;
}

void check_completed_flows(long current_time, long timeout_seconds) {
    if (!g_flow_complete_cb) return;

    std::vector<std::string> to_evict;

    for (const auto& [key, s] : flows) {
        bool completed = false;

        // FIN+ACK seen (both directions likely closed)
        if (s.fin_count >= 2 && s.ack_count >= 2) completed = true;
        // RST received
        if (s.rst_count > 0) completed = true;
        // Inactivity timeout
        if (current_time - s.last_seen > timeout_seconds) completed = true;

        if (completed) {
            g_flow_complete_cb(build_completed_flow(key, s));
            to_evict.push_back(key);
        }
    }

    for (const auto& key : to_evict) {
        flows.erase(key);
    }
}

void flush_all_flows(long current_time) {
    if (!g_flow_complete_cb) return;

    for (const auto& [key, s] : flows) {
        g_flow_complete_cb(build_completed_flow(key, s));
    }
    flows.clear();
}
