include(FetchContent)
FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)
FetchContent_MakeAvailable(googletest)

enable_testing()

# Common include paths
set(SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../src")

# --- test_ring_buffer ---
add_executable(test_ring_buffer test_ring_buffer.cpp)
target_include_directories(test_ring_buffer PRIVATE ${SRC_DIR})
target_link_libraries(test_ring_buffer PRIVATE gtest_main Threads::Threads)
add_test(NAME test_ring_buffer COMMAND test_ring_buffer)

# --- test_entropy ---
add_executable(test_entropy test_entropy.cpp)
target_include_directories(test_entropy PRIVATE ${SRC_DIR})
target_link_libraries(test_entropy PRIVATE gtest_main)
add_test(NAME test_entropy COMMAND test_entropy)

# --- test_tls_parser ---
add_executable(test_tls_parser test_tls_parser.cpp ${SRC_DIR}/features/tls_parser.cpp)
target_include_directories(test_tls_parser PRIVATE ${SRC_DIR} ${SRC_DIR}/features)
target_link_libraries(test_tls_parser PRIVATE gtest_main OpenSSL::Crypto)
add_test(NAME test_tls_parser COMMAND test_tls_parser)

# --- test_dns_parser ---
add_executable(test_dns_parser test_dns_parser.cpp ${SRC_DIR}/features/dns_parser.cpp)
target_include_directories(test_dns_parser PRIVATE ${SRC_DIR} ${SRC_DIR}/features)
target_link_libraries(test_dns_parser PRIVATE gtest_main)
add_test(NAME test_dns_parser COMMAND test_dns_parser)

# --- test_flow_tracker ---
add_executable(test_flow_tracker
    test_flow_tracker.cpp
    ${SRC_DIR}/features/flow_tracker.cpp
    ${SRC_DIR}/features/tls_parser.cpp
    ${SRC_DIR}/features/dns_parser.cpp
)
target_include_directories(test_flow_tracker PRIVATE ${SRC_DIR} ${SRC_DIR}/features)
target_link_libraries(test_flow_tracker PRIVATE gtest_main OpenSSL::Crypto)
add_test(NAME test_flow_tracker COMMAND test_flow_tracker)
