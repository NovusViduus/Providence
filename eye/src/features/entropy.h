#ifndef ENTROPY_H
#define ENTROPY_H

#include <cstdint>
#include <cmath>
#include <cstring>

// Shannon entropy of a byte buffer, returned in bits (0.0–8.0).
// High entropy (>7.0) suggests encrypted/compressed data.
// Low entropy (<3.0) suggests plaintext.
inline double shannon_entropy(const uint8_t* data, uint32_t len) {
    if (len == 0) return 0.0;

    uint32_t freq[256];
    std::memset(freq, 0, sizeof(freq));
    for (uint32_t i = 0; i < len; i++) {
        freq[data[i]]++;
    }

    double entropy = 0.0;
    double log2_val = std::log(2.0);
    for (int i = 0; i < 256; i++) {
        if (freq[i] == 0) continue;
        double p = (double)freq[i] / len;
        entropy -= p * (std::log(p) / log2_val);
    }
    return entropy;
}

#endif // ENTROPY_H
