#ifndef GRPC_DISPATCHER_H
#define GRPC_DISPATCHER_H

#include <string>

#ifdef HAS_GRPC
#include <memory>
#include <grpcpp/grpcpp.h>
#include "event.grpc.pb.h"
#endif

#include "event.pb.h"

class GrpcDispatcher {
public:
    explicit GrpcDispatcher(const std::string& target = "localhost:50051");

    bool connect();
    bool dispatch(const providence::ClassifiedEvent& event);

private:
    std::string target_;
#ifdef HAS_GRPC
    std::shared_ptr<grpc::Channel> channel_;
    std::unique_ptr<providence::EventService::Stub> stub_;
#endif
};

#endif // GRPC_DISPATCHER_H
