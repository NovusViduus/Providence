#!/usr/bin/env python3
"""Mock ML inference server for testing the Eye's Unix socket client.

Listens on /tmp/providence_ml.sock, reads length-prefixed FeatureVector
protobuf messages, and always responds with a BENIGN classification.

Usage: python3 mock_ml_server.py
"""

import os
import socket
import struct
import sys

SOCKET_PATH = "/tmp/providence_ml.sock"

# Minimal protobuf encoding for Classification {category: "BENIGN", confidence: 0.95}
# Field 1 (string category): tag=0x0A, len=6, "BENIGN"
# Field 3 (double confidence): tag=0x19, 8 bytes little-endian double 0.95
def make_classification_response():
    category = b"BENIGN"
    # field 1: tag 0x0A (field 1, wire type 2), varint length, bytes
    part1 = b'\x0a' + bytes([len(category)]) + category
    # field 3: tag 0x19 (field 3, wire type 1 = 64-bit), 8 bytes double
    import struct as st
    part3 = b'\x19' + st.pack('<d', 0.95)
    return part1 + part3


def main():
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(1)
    print(f"Mock ML server listening on {SOCKET_PATH}")

    response = make_classification_response()

    try:
        while True:
            conn, _ = server.accept()
            print("Client connected")
            try:
                while True:
                    # Read 4-byte length prefix
                    header = conn.recv(4)
                    if len(header) < 4:
                        break
                    msg_len = struct.unpack('!I', header)[0]

                    # Read the message
                    data = b''
                    while len(data) < msg_len:
                        chunk = conn.recv(msg_len - len(data))
                        if not chunk:
                            break
                        data += chunk

                    if len(data) < msg_len:
                        break

                    print(f"Received FeatureVector ({msg_len} bytes)")

                    # Send response
                    conn.sendall(struct.pack('!I', len(response)))
                    conn.sendall(response)
                    print(f"Sent Classification ({len(response)} bytes)")

            except Exception as e:
                print(f"Error: {e}")
            finally:
                conn.close()
                print("Client disconnected")
    except KeyboardInterrupt:
        print("\nShutting down")
    finally:
        server.close()
        os.unlink(SOCKET_PATH)


if __name__ == "__main__":
    main()
