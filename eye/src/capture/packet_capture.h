#ifndef CAPTURE_H
#define CAPTURE_H

#include <pcap/pcap.h>
#include "ring_buffer.h"

struct CaptureContext {
    RingBuffer<>* ring;
};

// Opens pcap handle, detects link-layer type, compiles BPF filter.
// Returns nullptr on failure (errors printed to stderr).
// Sets out_link_hdr_len to the detected link-layer header length.
pcap_t* open_capture(const char* iface, int& out_link_hdr_len);

// Runs pcap_loop. The callback enqueues packets into ctx->ring.
void run_capture(pcap_t* handle, CaptureContext* ctx);

// Signal-safe: calls pcap_breakloop on the given handle.
void stop_capture(pcap_t* handle);

#endif // CAPTURE_H
