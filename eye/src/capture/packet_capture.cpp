#include "packet_capture.h"

#include <iostream>
#include <cstdio>

static void pcap_callback(u_char* usr_data, const struct pcap_pkthdr* hdr, const u_char* pkt) {
    auto* ctx = reinterpret_cast<CaptureContext*>(usr_data);
    ctx->ring->try_push(pkt, hdr->caplen, hdr->ts.tv_sec);
}

pcap_t* open_capture(const char* iface, int& out_link_hdr_len) {
    char errbuf[PCAP_ERRBUF_SIZE];
    pcap_t* handle = pcap_open_live(iface, 65535, 1, 1000, errbuf);
    if (handle == nullptr) {
        std::cerr << "pcap_open_live(): " << errbuf << "\n";
        return nullptr;
    }

    int dlt = pcap_datalink(handle);
    if (dlt == DLT_NULL || dlt == DLT_LOOP) {
        out_link_hdr_len = 4;
    } else if (dlt == DLT_EN10MB) {
        out_link_hdr_len = 14;
    } else {
        std::cerr << "Unsupported link-layer type: " << dlt << "\n";
        pcap_close(handle);
        return nullptr;
    }

    struct bpf_program filter;
    if (pcap_compile(handle, &filter, "tcp or udp port 53", 0, PCAP_NETMASK_UNKNOWN) == -1) {
        std::cerr << "pcap_compile failed: " << pcap_geterr(handle) << "\n";
        pcap_close(handle);
        return nullptr;
    }
    if (pcap_setfilter(handle, &filter) == -1) {
        std::cerr << "pcap_setfilter failed: " << pcap_geterr(handle) << "\n";
        pcap_freecode(&filter);
        pcap_close(handle);
        return nullptr;
    }
    pcap_freecode(&filter);

    return handle;
}

void run_capture(pcap_t* handle, CaptureContext* ctx) {
    pcap_loop(handle, -1, pcap_callback, reinterpret_cast<u_char*>(ctx));
}

void stop_capture(pcap_t* handle) {
    pcap_breakloop(handle);
}
