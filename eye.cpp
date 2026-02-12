#include <iostream>
#include <pcap/pcap.h>
#include <map>
#include <string>
#include <csignal>
#include <iomanip>
#include <fstream>


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
    long first_seen = 0;
    long last_seen = 0;
};

std::map<std::string, FlowStats> flows;
int pk_count = 0;

pcap_t* global_handle = nullptr;

void stop_capture(int signum) {
    pcap_breakloop(global_handle);
}

void call_back(u_char* usr_data, const struct pcap_pkthdr* hdr, const u_char* pkt)
{
    char src_buf[16], dst_buf[16];
    snprintf(src_buf, sizeof(src_buf), "%d.%d.%d.%d", pkt[26], pkt[27], pkt[28], pkt[29]);
    std::string src_ip(src_buf);
    snprintf(dst_buf, sizeof(dst_buf), "%d.%d.%d.%d", pkt[30], pkt[31], pkt[32], pkt[33]);
    std::string dst_ip(dst_buf);
    uint16_t src_port = (pkt[34] << 8) | pkt[35];
    uint16_t dst_port = (pkt[36] << 8) | pkt[37];

    std::string side_a = src_ip + ":" + std::to_string(src_port);
    std::string side_b = dst_ip + ":" + std::to_string(dst_port);
    std::string key;
    if (side_a < side_b) {
        key = side_a + " <-> " + side_b;
    } else {
        key = side_b + " <-> " + side_a;
    }

    uint8_t flags = pkt[47];
    flows[key].packet_count++;
    flows[key].total_bytes += hdr->len;
    if (flags & 0x02) flows[key].syn_count++;
    if (flags & 0x10) flows[key].ack_count++;
    if (flags & 0x01) flows[key].fin_count++;
    if (flags & 0x04) flows[key].rst_count++;

    long timestamp = hdr->ts.tv_sec;
    if (flows[key].first_seen == 0) flows[key].first_seen = timestamp;
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
        long duration = stats.last_seen - stats.first_seen;
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

int main()
{
	char errbuf[PCAP_ERRBUF_SIZE];
	pcap_t* handle = pcap_open_live("en0", 65535, 1, 1000, errbuf);
	if (handle == nullptr)
	{
		printf("pcap_open_live(): %s\n", errbuf);
		return 1;
	}
	struct bpf_program filter;
	pcap_compile(handle, &filter, "tcp", 0, PCAP_NETMASK_UNKNOWN);
	pcap_setfilter(handle, &filter);
	pcap_freecode(&filter);
    global_handle = handle;
	signal(SIGINT, stop_capture);
	pcap_loop(handle, -1, call_back, nullptr);
    export_json();
    printf("\n=== The Eye — Flow Summary ===\n");
	printf("Total packets captured: %d\n", pk_count);
	printf("Unique flows: %zu\n\n", flows.size());
	printf("%-50s %6s %8s %5s %5s %5s %5s %8s %7s %7s\n",
       "Flow", "Pkts", "Bytes", "SYN", "ACK", "FIN", "RST", "Dur(s)", "Pkt/s", "SYN/ACK");
	printf("────────────────────────────────────────────────────────────────────────────────────────────────────────────\n");

	for (const auto& [key, stats] : flows) {
    	long duration = stats.last_seen - stats.first_seen;
    	float pps = duration > 0 ? (float)stats.packet_count / duration : 0;
    	float syn_ack = stats.ack_count > 0 ? (float)stats.syn_count / stats.ack_count : 0;

    	printf("%-50s %6d %8d %5d %5d %5d %5d %8ld %7.1f %7.2f\n",
        	key.c_str(),
            stats.packet_count,
            stats.total_bytes,
            stats.syn_count,
            stats.ack_count,
            stats.fin_count,
            stats.rst_count,
            duration,
            pps,
            syn_ack);
	}
	pcap_close(handle);
	return 0;
}
