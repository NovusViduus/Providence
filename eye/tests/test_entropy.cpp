#include <gtest/gtest.h>
#include "features/entropy.h"
#include <cmath>

TEST(Entropy, AllIdenticalBytes) {
    uint8_t data[256];
    std::memset(data, 0x00, sizeof(data));
    double e = shannon_entropy(data, 256);
    EXPECT_NEAR(e, 0.0, 0.001);
}

TEST(Entropy, PerfectlyUniform) {
    uint8_t data[256];
    for (int i = 0; i < 256; i++) data[i] = (uint8_t)i;
    double e = shannon_entropy(data, 256);
    EXPECT_NEAR(e, 8.0, 0.001);
}

TEST(Entropy, KnownString) {
    // "aaab" → freq: a=3, b=1, total=4
    // p(a)=0.75, p(b)=0.25
    // H = -(0.75*log2(0.75) + 0.25*log2(0.25))
    //   = -(0.75*(-0.41504) + 0.25*(-2.0))
    //   = -(−0.31128 + −0.5) = 0.81128
    uint8_t data[] = {'a', 'a', 'a', 'b'};
    double e = shannon_entropy(data, 4);
    double expected = -(0.75 * std::log2(0.75) + 0.25 * std::log2(0.25));
    EXPECT_NEAR(e, expected, 0.01);
}

TEST(Entropy, EmptyBuffer) {
    double e = shannon_entropy(nullptr, 0);
    EXPECT_DOUBLE_EQ(e, 0.0);
}
