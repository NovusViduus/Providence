FROM python:3.12-slim

WORKDIR /app

# Install protobuf compiler and OpenMP (needed by LightGBM)
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY ml/pyproject.toml .
RUN pip install --no-cache-dir -e '.'

# Copy source and proto
COPY ml/src/ src/
COPY proto/ proto/

# Generate protobuf stubs
RUN mkdir -p src/proto && protoc --python_out=src/proto/ -Iproto/ proto/*.proto && touch src/proto/__init__.py

# Symlink so 'from proto import features_pb2' works
RUN ln -s /app/src/proto /app/proto_py

# Copy pre-trained models (if available)
COPY ml/models/saved/ models/saved/

ENV PYTHONPATH=/app:/app/src/proto

CMD ["python", "-m", "src.server", "--socket-path", "/tmp/providence_ml.sock"]
