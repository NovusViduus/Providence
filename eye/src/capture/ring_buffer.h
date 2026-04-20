#ifndef RING_BUFFER_H
#define RING_BUFFER_H

#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>

struct PacketSlot {
    uint8_t data[65536];
    uint32_t len;
    long tv_sec;
};

template <size_t Capacity = 4096>
class RingBuffer {
public:
    RingBuffer() : slots_(std::make_unique<PacketSlot[]>(Capacity)) {}

    bool try_push(const uint8_t* pkt, uint32_t len, long tv_sec) {
        size_t head = head_.load(std::memory_order_relaxed);
        size_t next = (head + 1) % Capacity;
        if (next == tail_.load(std::memory_order_acquire)) {
            return false; // full
        }
        std::memcpy(slots_[head].data, pkt, len);
        slots_[head].len = len;
        slots_[head].tv_sec = tv_sec;
        head_.store(next, std::memory_order_release);
        return true;
    }

    bool try_pop(PacketSlot& out) {
        size_t tail = tail_.load(std::memory_order_relaxed);
        if (tail == head_.load(std::memory_order_acquire)) {
            return false; // empty
        }
        out = slots_[tail];
        tail_.store((tail + 1) % Capacity, std::memory_order_release);
        return true;
    }

    bool empty() const {
        return head_.load(std::memory_order_acquire) == tail_.load(std::memory_order_acquire);
    }

private:
    std::unique_ptr<PacketSlot[]> slots_;
    alignas(64) std::atomic<size_t> head_{0};
    alignas(64) std::atomic<size_t> tail_{0};
};

#endif // RING_BUFFER_H
