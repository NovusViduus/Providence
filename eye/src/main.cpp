#include <csignal>
#include <atomic>
#include <thread>
#include <string>
#include <cstring>
#include <iostream>

#include "capture/ring_buffer.h"
#include "capture/packet_capture.h"
#include "processor.h"
#include "features/flow_tracker.h"
#include "bridge/ml_client.h"
#include "dispatcher/grpc_dispatcher.h"

static pcap_t* g_handle = nullptr;

static void sigint_handler(int) {
    if (g_handle) stop_capture(g_handle);
}

static void print_usage(const char* prog) {
    std::cerr << "Usage: " << prog << " [interface] [--citadel host:port] [--ml-socket path]\n"
              << "  interface       Network interface (default: en0)\n"
              << "  --citadel       gRPC target for The Citadel (default: localhost:50051)\n"
              << "  --ml-socket     Unix socket path for ML service (default: /tmp/providence_ml.sock)\n";
}

int main(int argc, char* argv[]) {
    std::string iface = "en0";
    std::string citadel_target = "localhost:50051";
    std::string ml_socket = "/tmp/providence_ml.sock";

    // Parse args
    for (int i = 1; i < argc; i++) {
        if (std::strcmp(argv[i], "--citadel") == 0 && i + 1 < argc) {
            citadel_target = argv[++i];
        } else if (std::strcmp(argv[i], "--ml-socket") == 0 && i + 1 < argc) {
            ml_socket = argv[++i];
        } else if (std::strcmp(argv[i], "--help") == 0 || std::strcmp(argv[i], "-h") == 0) {
            print_usage(argv[0]);
            return 0;
        } else if (argv[i][0] != '-') {
            iface = argv[i];
        }
    }

    int link_hdr_len = 14;
    pcap_t* handle = open_capture(iface.c_str(), link_hdr_len);
    if (!handle) return 1;

    g_handle = handle;
    std::signal(SIGINT, sigint_handler);

    RingBuffer<> ring;
    std::atomic<bool> shutdown{false};

    CaptureContext ctx{&ring};

    // Initialize ML client and gRPC dispatcher
    MlClient ml_client(ml_socket);
    GrpcDispatcher dispatcher(citadel_target);
    dispatcher.connect();

    std::thread worker(processor_run, &ring, std::ref(shutdown), link_hdr_len,
                       &ml_client, &dispatcher);

    run_capture(handle, &ctx);  // blocks until SIGINT

    shutdown.store(true, std::memory_order_release);
    worker.join();

    pcap_close(handle);

    export_json();
    print_summary();

    return 0;
}
