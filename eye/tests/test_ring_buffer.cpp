#include <gtest/gtest.h>
#include <thread>
#include <atomic>
#include "capture/ring_buffer.h"

TEST(RingBuffer, PushPopSingle) {
    RingBuffer<16> rb;
    uint8_t data[] = {0xDE, 0xAD, 0xBE, 0xEF};
    ASSERT_TRUE(rb.try_push(data, 4, 1000));

    PacketSlot slot;
    ASSERT_TRUE(rb.try_pop(slot));
    EXPECT_EQ(slot.len, 4u);
    EXPECT_EQ(slot.tv_sec, 1000);
    EXPECT_EQ(slot.data[0], 0xDE);
    EXPECT_EQ(slot.data[1], 0xAD);
    EXPECT_EQ(slot.data[2], 0xBE);
    EXPECT_EQ(slot.data[3], 0xEF);
}

TEST(RingBuffer, FullBuffer) {
    // Capacity 4 means 3 usable slots (one wasted for full detection)
    RingBuffer<4> rb;
    uint8_t data[] = {0x01};
    ASSERT_TRUE(rb.try_push(data, 1, 1));
    ASSERT_TRUE(rb.try_push(data, 1, 2));
    ASSERT_TRUE(rb.try_push(data, 1, 3));
    ASSERT_FALSE(rb.try_push(data, 1, 4));  // full
}

TEST(RingBuffer, PopEmpty) {
    RingBuffer<16> rb;
    PacketSlot slot;
    ASSERT_FALSE(rb.try_pop(slot));
}

TEST(RingBuffer, FIFOOrder) {
    RingBuffer<64> rb;
    for (int i = 0; i < 50; i++) {
        uint8_t val = (uint8_t)i;
        ASSERT_TRUE(rb.try_push(&val, 1, i * 100));
    }

    for (int i = 0; i < 50; i++) {
        PacketSlot slot;
        ASSERT_TRUE(rb.try_pop(slot));
        EXPECT_EQ(slot.data[0], (uint8_t)i);
        EXPECT_EQ(slot.tv_sec, i * 100);
        EXPECT_EQ(slot.len, 1u);
    }

    PacketSlot slot;
    ASSERT_FALSE(rb.try_pop(slot));
}

TEST(RingBuffer, TimestampPreserved) {
    RingBuffer<16> rb;
    uint8_t data[] = {0x00};
    long ts = 1712345678;
    ASSERT_TRUE(rb.try_push(data, 1, ts));

    PacketSlot slot;
    ASSERT_TRUE(rb.try_pop(slot));
    EXPECT_EQ(slot.tv_sec, ts);
}

TEST(RingBuffer, ConcurrentProducerConsumer) {
    RingBuffer<1024> rb;
    const int NUM_PACKETS = 10000;
    std::atomic<int> consumed{0};

    std::thread producer([&]() {
        for (int i = 0; i < NUM_PACKETS; i++) {
            uint8_t buf[4];
            buf[0] = (uint8_t)(i & 0xFF);
            buf[1] = (uint8_t)((i >> 8) & 0xFF);
            buf[2] = (uint8_t)((i >> 16) & 0xFF);
            buf[3] = (uint8_t)((i >> 24) & 0xFF);
            while (!rb.try_push(buf, 4, i)) {
                std::this_thread::yield();
            }
        }
    });

    std::thread consumer([&]() {
        int expected = 0;
        while (expected < NUM_PACKETS) {
            PacketSlot slot;
            if (rb.try_pop(slot)) {
                int val = slot.data[0] | (slot.data[1] << 8) |
                          (slot.data[2] << 16) | (slot.data[3] << 24);
                EXPECT_EQ(val, expected);
                EXPECT_EQ(slot.len, 4u);
                EXPECT_EQ(slot.tv_sec, expected);
                expected++;
                consumed.fetch_add(1);
            } else {
                std::this_thread::yield();
            }
        }
    });

    producer.join();
    consumer.join();
    EXPECT_EQ(consumed.load(), NUM_PACKETS);
}
