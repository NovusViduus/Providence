#include <iostream>
#include <pcap/pcap.h>
#include <unordered_map>
#include <string>
#include <csignal>
#include <iomanip>
#include <fstream>
#include <optional>


struct FlowKey {
    std::string src_ip;
    std::string dst_ip;
    uint16_t src_port;
    uint16_t dst_port;
};

struct FlowStats {
    int packet_count = 0;
    int total_bytes = 0;
    int syn_count = 0;
    int ack_count = 0;
    int fin_count = 0;
    int rst_count = 0;
    int psh_count = 0;
    std::optional<long> first_seen;
    long last_seen = 0;
};

std::unordered_map<std::string, FlowStats> flows;
int pk_count = 0;

pcap_t* global_handle = nullptr;
int link_hdr_len = 14; // default Ethernet

void stop_capture(int signum) {
    pcap_breakloop(global_handle);
}

void call_back(u_char* usr_data, const struct pcap_pkthdr* hdr, const u_char* pkt)
{
    int offset = link_hdr_len;

    uint8_t ihl = (pkt[offset] & 0x0F) * 4;

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
    if (side_a < side_b) {
        key = side_a + " <-> " + side_b;
    } else {
        key = side_b + " <-> " + side_a;
    }

    uint8_t flags = pkt[tcp_offset + 13];
    flows[key].packet_count++;
    flows[key].total_bytes += hdr->len;
    if (flags & 0x02) flows[key].syn_count++;
    if (flags & 0x10) flows[key].ack_count++;
    if (flags & 0x01) flows[key].fin_count++;
    if (flags & 0x04) flows[key].rst_count++;
    if (flags & 0x08) flows[key].psh_count++;

    long timestamp = hdr->ts.tv_sec;
    if (!flows[key].first_seen.has_value()) flows[key].first_seen = timestamp;
    flows[key].last_seen = timestamp;

    pk_count++;
}

void export_json() {
    std::ofstream json_file("flow_export.json");
    if (!json_file.is_open()) {
        std::cerr << "Failed to create JSON file." << std::endl;
        return;
    }

    json_file << "[\n";

    size_t count = 0;
    for (const auto& [key, stats] : flows) {
        long duration = stats.first_seen.has_value() ? stats.last_seen - stats.first_seen.value() : 0;
        float pps = duration > 0 ? (float)stats.packet_count / duration : 0;
        float syn_ack = stats.ack_count > 0 ? (float)stats.syn_count / stats.ack_count : 0;

        json_file << "  {\n";
        json_file << "    \"flow\": \"" << key << "\",\n";
        json_file << "    \"packets\": " << stats.packet_count << ",\n";
        json_file << "    \"bytes\": " << stats.total_bytes << ",\n";
        json_file << "    \"syn\": " << stats.syn_count << ",\n";
        json_file << "    \"ack\": " << stats.ack_count << ",\n";
        json_file << "    \"fin\": " << stats.fin_count << ",\n";
        json_file << "    \"rst\": " << stats.rst_count << ",\n";
        json_file << "    \"psh\": " << stats.psh_count << ",\n";
        json_file << "    \"duration\": " << duration << ",\n";
        json_file << "    \"pps\": " << std::fixed << std::setprecision(1) << pps << ",\n";
        json_file << "    \"syn_ack_ratio\": " << std::fixed << std::setprecision(2) << syn_ack << "\n";

        if (++count < flows.size()) {
            json_file << "  },\n";
        } else {
            json_file << "  }\n";
        }
    }

    json_file << "]";
    json_file.close();
    printf("\nData exported to flow_export.json\n");
}

int main(int argc, char* argv[])
{
	const char* iface = argc > 1 ? argv[1] : "en0";
	char errbuf[PCAP_ERRBUF_SIZE];
	pcap_t* handle = pcap_open_live(iface, 65535, 1, 1000, errbuf);
	if (handle == nullptr)
	{
		printf("pcap_open_live(): %s\n", errbuf);
		return 1;
	}

	// Check link-layer type and set header length
	int dlt = pcap_datalink(handle);
	if (dlt == DLT_NULL || dlt == DLT_LOOP) {
		link_hdr_len = 4;
	} else if (dlt == DLT_EN10MB) {
		link_hdr_len = 14;
	} else {
		std::cerr << "Unsupported link-layer type: " << dlt << "\n";
		pcap_close(handle);
		return 1;
	}

	struct bpf_program filter;
	if (pcap_compile(handle, &filter, "tcp", 0, PCAP_NETMASK_UNKNOWN) == -1) {
		std::cerr << "pcap_compile failed: " << pcap_geterr(handle) << "\n";
		pcap_close(handle);
		return 1;
	}
	if (pcap_setfilter(handle, &filter) == -1) {
		std::cerr << "pcap_setfilter failed: " << pcap_geterr(handle) << "\n";
		pcap_freecode(&filter);
		pcap_close(handle);
		return 1;
	}
	pcap_freecode(&filter);

    global_handle = handle;
	signal(SIGINT, stop_capture);
	pcap_loop(handle, -1, call_back, nullptr);
    export_json();
    printf("\n=== The Eye — Flow Summary ===\n");
	printf("Total packets captured: %d\n", pk_count);
	printf("Unique flows: %zu\n\n", flows.size());
	printf("%-50s %6s %8s %5s %5s %5s %5s %5s %8s %7s %7s\n",
       "Flow", "Pkts", "Bytes", "SYN", "ACK", "FIN", "RST", "PSH", "Dur(s)", "Pkt/s", "SYN/ACK");
	printf("────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\n");

	for (const auto& [key, stats] : flows) {
    	long duration = stats.first_seen.has_value() ? stats.last_seen - stats.first_seen.value() : 0;
    	float pps = duration > 0 ? (float)stats.packet_count / duration : 0;
    	float syn_ack = stats.ack_count > 0 ? (float)stats.syn_count / stats.ack_count : 0;

    	printf("%-50s %6d %8d %5d %5d %5d %5d %5d %8ld %7.1f %7.2f\n",
        	key.c_str(),
            stats.packet_count,
            stats.total_bytes,
            stats.syn_count,
            stats.ack_count,
            stats.fin_count,
            stats.rst_count,
            stats.psh_count,
            duration,
            pps,
            syn_ack);
	}
	pcap_close(handle);
	return 0;
}
