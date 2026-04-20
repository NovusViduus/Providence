FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential cmake pkg-config \
    libpcap-dev libssl-dev \
    protobuf-compiler libprotobuf-dev \
    libgrpc++-dev protobuf-compiler-grpc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY proto/ /app/proto/
COPY eye/ /app/eye/

WORKDIR /app/eye
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y \
    libpcap0.8 libssl3 libprotobuf32 libgrpc++1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/eye/build/eye /usr/local/bin/eye

# Requires NET_RAW capability for packet capture.
# Run with: docker run --cap-add=NET_RAW --network=host providence-eye [interface]
ENTRYPOINT ["eye"]
CMD ["eth0"]
