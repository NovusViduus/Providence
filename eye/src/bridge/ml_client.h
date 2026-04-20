#ifndef ML_CLIENT_H
#define ML_CLIENT_H

#include <string>
#include <optional>
#include "features.pb.h"
#include "event.pb.h"

class MlClient {
public:
    explicit MlClient(const std::string& socket_path = "/tmp/providence_ml.sock");
    ~MlClient();

    bool connect();
    void disconnect();
    bool is_connected() const;

    // Send a feature vector, receive a classification.
    // Returns nullopt on connection failure or timeout.
    std::optional<providence::Classification> classify(const providence::FeatureVector& features);

private:
    bool write_message(const std::string& data);
    bool read_message(std::string& data);

    std::string socket_path_;
    int fd_ = -1;
};

#endif // ML_CLIENT_H
