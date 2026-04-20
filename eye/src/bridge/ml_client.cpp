#include "ml_client.h"

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <iostream>
#include <cstring>

MlClient::MlClient(const std::string& socket_path)
    : socket_path_(socket_path) {}

MlClient::~MlClient() {
    disconnect();
}

bool MlClient::connect() {
    if (fd_ >= 0) return true;

    fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd_ < 0) {
        std::cerr << "[ml_client] socket() failed: " << strerror(errno) << "\n";
        return false;
    }

    // Set 500ms read timeout
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 500000;
    setsockopt(fd_, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_un addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, socket_path_.c_str(), sizeof(addr.sun_path) - 1);

    if (::connect(fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::cerr << "[ml_client] connect() failed: " << strerror(errno) << "\n";
        ::close(fd_);
        fd_ = -1;
        return false;
    }

    return true;
}

void MlClient::disconnect() {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

bool MlClient::is_connected() const {
    return fd_ >= 0;
}

bool MlClient::write_message(const std::string& data) {
    uint32_t len = htonl(static_cast<uint32_t>(data.size()));
    if (::write(fd_, &len, 4) != 4) return false;
    ssize_t total = 0;
    while (total < (ssize_t)data.size()) {
        ssize_t n = ::write(fd_, data.data() + total, data.size() - total);
        if (n <= 0) return false;
        total += n;
    }
    return true;
}

bool MlClient::read_message(std::string& data) {
    uint32_t len_net;
    ssize_t n = ::read(fd_, &len_net, 4);
    if (n != 4) return false;

    uint32_t len = ntohl(len_net);
    if (len > 1024 * 1024) return false;  // sanity: 1MB max

    data.resize(len);
    ssize_t total = 0;
    while (total < (ssize_t)len) {
        n = ::read(fd_, &data[0] + total, len - total);
        if (n <= 0) return false;
        total += n;
    }
    return true;
}

std::optional<providence::Classification> MlClient::classify(
    const providence::FeatureVector& features)
{
    // Ensure connected, with one reconnect attempt
    if (!is_connected()) {
        if (!connect()) return std::nullopt;
    }

    std::string serialized;
    if (!features.SerializeToString(&serialized)) {
        std::cerr << "[ml_client] Failed to serialize FeatureVector\n";
        return std::nullopt;
    }

    if (!write_message(serialized)) {
        std::cerr << "[ml_client] Write failed, attempting reconnect\n";
        disconnect();
        if (!connect() || !write_message(serialized)) {
            return std::nullopt;
        }
    }

    std::string response_data;
    if (!read_message(response_data)) {
        std::cerr << "[ml_client] Read failed\n";
        disconnect();
        return std::nullopt;
    }

    providence::Classification classification;
    if (!classification.ParseFromString(response_data)) {
        std::cerr << "[ml_client] Failed to parse Classification response\n";
        return std::nullopt;
    }

    return classification;
}
