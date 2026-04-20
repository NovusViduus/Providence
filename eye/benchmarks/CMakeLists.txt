set(SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../src")

add_executable(throughput_bench
    throughput_bench.cpp
    ${SRC_DIR}/features/flow_tracker.cpp
    ${SRC_DIR}/features/tls_parser.cpp
    ${SRC_DIR}/features/dns_parser.cpp
)

target_include_directories(throughput_bench PRIVATE
    ${SRC_DIR}
    ${SRC_DIR}/features
)

target_link_libraries(throughput_bench PRIVATE
    OpenSSL::Crypto
)
