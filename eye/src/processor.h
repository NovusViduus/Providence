#ifndef PROCESSOR_H
#define PROCESSOR_H

#include <atomic>
#include "capture/ring_buffer.h"

class MlClient;
class GrpcDispatcher;

// Drains the ring buffer, processes packets, classifies completed flows.
void processor_run(RingBuffer<>* ring, std::atomic<bool>& shutdown, int link_hdr_len,
                   MlClient* ml_client, GrpcDispatcher* dispatcher);

#endif // PROCESSOR_H
