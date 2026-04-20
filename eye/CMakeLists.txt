cmake_minimum_required(VERSION 3.16)
project(eye LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Options
option(BUILD_TESTS "Build test suites" ON)
option(BUILD_BENCHMARKS "Build benchmarks" ON)

# Compile flags
set(CMAKE_CXX_FLAGS_RELEASE "-Wall -Wextra -O2")
set(CMAKE_CXX_FLAGS_DEBUG "-Wall -Wextra -g -O0")

# --- Dependencies ---
find_package(Threads REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(PCAP REQUIRED libpcap)
find_package(OpenSSL REQUIRED)

# Protobuf — try CMake config first, fall back to pkg-config + find_program
find_package(Protobuf CONFIG QUIET)
if(NOT Protobuf_FOUND)
    find_package(Protobuf QUIET)
endif()

if(Protobuf_FOUND AND TARGET protobuf::protoc)
    set(PROTOC_CMD protobuf::protoc)
    message(STATUS "Protobuf: using CMake target protobuf::protoc")
else()
    # Fallback: find protoc binary and protobuf library directly
    find_program(PROTOC_BIN protoc)
    if(NOT PROTOC_BIN)
        message(FATAL_ERROR "protoc not found. Install protobuf-compiler.")
    endif()
    set(PROTOC_CMD ${PROTOC_BIN})
    message(STATUS "Protobuf: using system protoc at ${PROTOC_BIN}")

    # Find protobuf library if CMake didn't
    if(NOT TARGET protobuf::libprotobuf)
        pkg_check_modules(PROTOBUF REQUIRED protobuf)
    endif()
endif()

find_package(gRPC CONFIG QUIET)

# --- Protobuf generation ---
set(PROTO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../proto")
set(PROTO_FILES
    ${PROTO_DIR}/features.proto
    ${PROTO_DIR}/event.proto
    ${PROTO_DIR}/response.proto
)

# Generate C++ sources from .proto files
set(PROTO_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/proto_gen")
file(MAKE_DIRECTORY ${PROTO_GEN_DIR})

set(PROTO_SRCS)
set(PROTO_HDRS)
set(GRPC_SRCS)
set(GRPC_HDRS)

foreach(PROTO_FILE ${PROTO_FILES})
    get_filename_component(PROTO_NAME ${PROTO_FILE} NAME_WE)

    list(APPEND PROTO_SRCS "${PROTO_GEN_DIR}/${PROTO_NAME}.pb.cc")
    list(APPEND PROTO_HDRS "${PROTO_GEN_DIR}/${PROTO_NAME}.pb.h")

    add_custom_command(
        OUTPUT "${PROTO_GEN_DIR}/${PROTO_NAME}.pb.cc" "${PROTO_GEN_DIR}/${PROTO_NAME}.pb.h"
        COMMAND ${PROTOC_CMD}
        ARGS --cpp_out=${PROTO_GEN_DIR} -I${PROTO_DIR} ${PROTO_FILE}
        DEPENDS ${PROTO_FILE}
        COMMENT "Generating protobuf C++ for ${PROTO_NAME}.proto"
    )
endforeach()

# gRPC generation for event.proto (has service definition)
if(gRPC_FOUND)
    find_program(GRPC_CPP_PLUGIN grpc_cpp_plugin)
    if(GRPC_CPP_PLUGIN)
        set(EVENT_PROTO "${PROTO_DIR}/event.proto")
        list(APPEND GRPC_SRCS "${PROTO_GEN_DIR}/event.grpc.pb.cc")
        list(APPEND GRPC_HDRS "${PROTO_GEN_DIR}/event.grpc.pb.h")

        add_custom_command(
            OUTPUT "${PROTO_GEN_DIR}/event.grpc.pb.cc" "${PROTO_GEN_DIR}/event.grpc.pb.h"
            COMMAND ${PROTOC_CMD}
            ARGS --grpc_out=${PROTO_GEN_DIR}
                 --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
                 -I${PROTO_DIR} ${EVENT_PROTO}
            DEPENDS ${EVENT_PROTO}
            COMMENT "Generating gRPC C++ stubs for event.proto"
        )
    endif()
endif()

# --- Source files ---
set(EYE_SOURCES
    src/main.cpp
    src/capture/packet_capture.cpp
    src/features/flow_tracker.cpp
    src/features/tls_parser.cpp
    src/features/dns_parser.cpp
    src/processor.cpp
    src/bridge/ml_client.cpp
    src/dispatcher/grpc_dispatcher.cpp
    ${PROTO_SRCS}
    ${GRPC_SRCS}
)

add_executable(eye ${EYE_SOURCES})

target_include_directories(eye PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${PROTO_GEN_DIR}
    ${PCAP_INCLUDE_DIRS}
)

# Link protobuf — prefer CMake target, fall back to pkg-config
if(TARGET protobuf::libprotobuf)
    target_link_libraries(eye PRIVATE
        ${PCAP_LIBRARIES}
        Threads::Threads
        OpenSSL::Crypto
        protobuf::libprotobuf
    )
else()
    target_include_directories(eye PRIVATE ${PROTOBUF_INCLUDE_DIRS})
    target_link_libraries(eye PRIVATE
        ${PCAP_LIBRARIES}
        Threads::Threads
        OpenSSL::Crypto
        ${PROTOBUF_LIBRARIES}
    )
endif()

if(gRPC_FOUND)
    target_link_libraries(eye PRIVATE
        gRPC::grpc++
        gRPC::grpc++_reflection
    )
    target_compile_definitions(eye PRIVATE HAS_GRPC=1)
endif()

# --- Subdirectories (optional for deployment) ---
if(BUILD_TESTS)
    add_subdirectory(tests)
endif()
if(BUILD_BENCHMARKS)
    add_subdirectory(benchmarks)
endif()
