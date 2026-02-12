#include <iostream>
#include <pcap/pcap.h>
#include <map>
#include <string>
#include <csignal>


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
    std::string key = src_ip + ":" + std::to_string(src_port) + " -> " +
                  dst_ip + ":" + std::to_string(dst_port);
	uint8_t flags = pkt[47];
    flows[key].packet_count++;
	flows[key].total_bytes += hdr->len;
	if (flags & 0x02) flows[key].syn_count++;
	if (flags & 0x10) flows[key].ack_count++;
	if (flags & 0x01) flows[key].fin_count++;
	if (flags & 0x04) flows[key].rst_count++;
	pk_count++;
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

    global_handle = handle;
	signal(SIGINT, stop_capture);
	pcap_loop(handle, -1, call_back, nullptr);
    printf("\n=== The Eye — Flow Summary ===\n");
	printf("Total packets captured: %d\n", pk_count);
	printf("Unique flows: %zu\n\n", flows.size());
	printf("%-45s %8s %10s %5s %5s %5s %5s\n",
       "Flow", "Packets", "Bytes", "SYN", "ACK", "FIN", "RST");
	printf("──────────────────────────────────────────────────────────────────────────────────────\n");

	for (const auto& [key, stats] : flows) {
    	printf("%-45s %8d %10d %5d %5d %5d %5d\n",
           key.c_str(),
           stats.packet_count,
           stats.total_bytes,
           stats.syn_count,
           stats.ack_count,
           stats.fin_count,
           stats.rst_count);
	}
	pcap_close(handle);
	return 0;
}