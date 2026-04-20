#include "grpc_dispatcher.h"
#include <iostream>

GrpcDispatcher::GrpcDispatcher(const std::string& target)
    : target_(target) {}

bool GrpcDispatcher::connect() {
#ifdef HAS_GRPC
    channel_ = grpc::CreateChannel(target_, grpc::InsecureChannelCredentials());
    stub_ = providence::EventService::NewStub(channel_);
    return stub_ != nullptr;
#else
    std::cerr << "[dispatcher] gRPC not available, events will be logged only\n";
    return false;
#endif
}

bool GrpcDispatcher::dispatch(const providence::ClassifiedEvent& event) {
#ifdef HAS_GRPC
    if (!stub_) {
        std::cerr << "[dispatcher] Not connected\n";
        return false;
    }

    grpc::ClientContext context;
    context.set_deadline(std::chrono::system_clock::now() + std::chrono::seconds(2));

    providence::EventAck ack;
    grpc::Status status = stub_->ReportEvent(&context, event, &ack);

    if (!status.ok()) {
        std::cerr << "[dispatcher] ReportEvent failed: " << status.error_message() << "\n";
        return false;
    }

    return ack.accepted();
#else
    std::cerr << "[dispatcher] (no gRPC) event_id=" << event.event_id()
              << " src=" << event.source_ip() << ":" << event.source_port()
              << " category=" << event.classification().category()
              << " confidence=" << event.classification().confidence() << "\n";
    return false;
#endif
}
