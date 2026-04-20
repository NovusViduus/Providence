#include "processor.h"
#include "features/flow_tracker.h"
#include "bridge/ml_client.h"
#include "dispatcher/grpc_dispatcher.h"

#include "features.pb.h"
#include "event.pb.h"

#include <thread>
#include <chrono>
#include <iostream>
#include <cstdio>
#include <ctime>

static void classify_and_dispatch(const CompletedFlow& cf, MlClient* ml, GrpcDispatcher* dispatcher) {
    // Build FeatureVector protobuf
    providence::FeatureVector fv;
    fv.set_src_ip(cf.src_ip);
    fv.set_dst_ip(cf.dst_ip);
    fv.set_src_port(cf.src_port);
    fv.set_dst_port(cf.dst_port);
    fv.set_protocol(6);  // TCP
    fv.set_ttl(cf.ttl);
    fv.set_syn_count(cf.syn_count);
    fv.set_ack_count(cf.ack_count);
    fv.set_fin_count(cf.fin_count);
    fv.set_rst_count(cf.rst_count);
    fv.set_psh_count(cf.psh_count);
    fv.set_urg_count(cf.urg_count);
    fv.set_window_size_min(cf.window_size_min);
    fv.set_window_size_max(cf.window_size_max);
    fv.set_window_size_mean(cf.window_size_mean);
    fv.set_duration(cf.duration);
    fv.set_packets_per_sec(cf.packets_per_sec);
    fv.set_bytes_per_sec(cf.bytes_per_sec);
    fv.set_packet_count(cf.packet_count);
    fv.set_total_bytes(cf.total_bytes);
    fv.set_packet_count_fwd(cf.packet_count_fwd);
    fv.set_packet_count_bwd(cf.packet_count_bwd);
    fv.set_bytes_fwd(cf.bytes_fwd);
    fv.set_bytes_bwd(cf.bytes_bwd);
    fv.set_payload_entropy_mean(cf.payload_entropy_mean);
    fv.set_payload_size_min(cf.payload_size_min);
    fv.set_payload_size_max(cf.payload_size_max);
    fv.set_payload_size_mean(cf.payload_size_mean);
    fv.set_zero_payload_count(cf.zero_payload_count);
    fv.set_ja3_hash(cf.ja3_hash);
    fv.set_ja3_seen(cf.ja3_seen);
    fv.set_cipher_suite_count(cf.cipher_suite_count);
    fv.set_extension_count(cf.extension_count);
    fv.set_inter_arrival_mean(cf.inter_arrival_mean);
    fv.set_inter_arrival_std(cf.inter_arrival_std);
    fv.set_inter_arrival_min(cf.inter_arrival_min);
    fv.set_inter_arrival_max(cf.inter_arrival_max);

    // Call ML service
    auto classification = ml->classify(fv);
    if (!classification.has_value()) {
        std::cerr << "[processor] ML service unavailable for flow " << cf.flow_key << "\n";
        return;
    }

    auto& cls = classification.value();
    printf("[CLASSIFY] %s → %s (%.3f)\n", cf.flow_key.c_str(),
           cls.category().c_str(), cls.confidence());

    // Build ClassifiedEvent for Citadel (Phase 2 flattened contract)
    providence::ClassifiedEvent event;
    event.set_event_id(cf.flow_key + "_" + std::to_string(std::time(nullptr)));
    event.set_timestamp(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
    event.set_source_ip(cf.src_ip);
    event.set_source_port(cf.src_port);
    event.set_dest_ip(cf.dst_ip);
    event.set_dest_port(cf.dst_port);
    event.set_protocol("TCP");
    event.mutable_classification()->CopyFrom(cls);
    event.set_source_component("eye");
    event.set_ja3_hash(cf.ja3_hash);
    event.set_flow_duration(cf.flow_duration_secs);
    event.set_packet_count(cf.packet_count);
    event.set_byte_count(cf.total_bytes);

    // Dispatch to Citadel
    if (!dispatcher->dispatch(event)) {
        std::cerr << "[processor] Failed to dispatch event for flow " << cf.flow_key << "\n";
    }
}

void processor_run(RingBuffer<>* ring, std::atomic<bool>& shutdown, int link_hdr_len,
                   MlClient* ml_client, GrpcDispatcher* dispatcher) {
    // Set up flow completion callback
    set_flow_complete_callback([ml_client, dispatcher](const CompletedFlow& cf) {
        classify_and_dispatch(cf, ml_client, dispatcher);
    });

    PacketSlot slot;
    auto last_sweep = std::chrono::steady_clock::now();

    while (true) {
        if (ring->try_pop(slot)) {
            uint8_t protocol = slot.data[link_hdr_len + 9];
            if (protocol == 6) {
                process_packet(slot.data, slot.len, slot.tv_sec, link_hdr_len);
            } else if (protocol == 17) {
                process_dns_packet(slot.data, slot.len, slot.tv_sec, link_hdr_len);
            }

            // Periodic sweep for completed/timed-out flows (every 5 seconds)
            auto now = std::chrono::steady_clock::now();
            if (std::chrono::duration_cast<std::chrono::seconds>(now - last_sweep).count() >= 5) {
                check_completed_flows(slot.tv_sec, 30);
                last_sweep = now;
            }
        } else if (shutdown.load(std::memory_order_acquire)) {
            // Drain remaining packets
            while (ring->try_pop(slot)) {
                uint8_t protocol = slot.data[link_hdr_len + 9];
                if (protocol == 6) {
                    process_packet(slot.data, slot.len, slot.tv_sec, link_hdr_len);
                } else if (protocol == 17) {
                    process_dns_packet(slot.data, slot.len, slot.tv_sec, link_hdr_len);
                }
            }
            // Flush all remaining flows
            flush_all_flows(std::time(nullptr));
            break;
        } else {
            std::this_thread::sleep_for(std::chrono::microseconds(100));
        }
    }
}
