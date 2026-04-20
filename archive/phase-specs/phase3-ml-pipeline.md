# Phase 3: ML Pipeline — Classification

> Providence Network Security Intelligence Platform
> Component: ML Classification Service + Eye Integration
> Timeline: Weeks 7–9
> Prerequisites: Phase 1 (The Eye) complete, Phase 2 (The Citadel) complete

---

## Goal

Train attack classifiers on CICIDS2017/2018 (benchmark baseline) and honeypot data (real 2026 traffic), serve them via a Python inference service over a Unix domain socket, wire The Eye's processor loop to call the ML service on flow completion, update The Eye's gRPC dispatcher to forward classified events to The Citadel using the Phase 2 proto contract, and validate the full pipeline end-to-end: live traffic → capture → extract → classify → store.

---

## Deliverable

A real-time traffic classification pipeline. Model evaluation document complete. The Eye sends feature vectors to the ML service, receives classifications, and forwards classified events to The Citadel. `MODEL_EVALUATION.md` published with per-category metrics, confusion matrices, and honest limitations.

---

## Context

### Upstream: The Eye (Phase 1)

The Eye's `MlClient` (`bridge/ml_client.h/.cpp`) is already built but **not wired into the processor loop**. It connects to a Unix domain socket and uses a 4-byte big-endian length prefix + serialized protobuf wire protocol:

- **Sends:** `FeatureVector` (proto/features.proto, 40 fields)
- **Receives:** `Classification` (proto/event.proto)
- **Socket path:** `/tmp/providence_ml.sock` (configurable via `--ml-socket`)
- **Timeout:** 500ms read via `SO_RCVTIMEO`
- **Reconnect:** One automatic retry on write failure
- **Returns:** `std::optional<Classification>` — nullopt on failure

The Eye's `GrpcDispatcher` was coded against the Phase 1 proto. Phase 2 changed `event.proto`: `SubmitEvent` → `ReportEvent`, nested structure → flattened fields, `confidence` from `double` → `float`, added `response_action` to `EventAck`, removed `StreamEvents` RPC. **The dispatcher must be updated.**

The Eye's flow tracker exports these fields per flow (from `eye_status.md`):

```
packet_count, total_bytes, syn_count, ack_count, fin_count, rst_count,
psh_count, urg_count, packet_count_fwd, packet_count_bwd, bytes_fwd,
bytes_bwd, first_seen, last_seen, duration, window_size_min,
window_size_max, window_size_sum, window_size_mean, entropy_sum,
entropy_count, entropy_mean, payload_size_min, payload_size_max,
payload_size_sum, payload_count, payload_size_mean, zero_payload_count,
ttl, ja3_hash, ja3_seen, cipher_suite_count, extension_count,
inter_arrival_mean, inter_arrival_std, inter_arrival_min,
inter_arrival_max, packets_per_sec, bytes_per_sec, syn_ack_ratio
```

### Downstream: The Citadel (Phase 2)

The Citadel's gRPC `EventService.ReportEvent` endpoint accepts `ClassifiedEvent` messages and returns `EventAck` with the assigned response tier (OBSERVE/RECOMMEND/ACT).

### CICIDS2017/2018 Datasets

These are labeled network flow datasets from the Canadian Institute for Cybersecurity. They contain pre-computed flow-level features (similar but not identical to The Eye's feature set) with labels: BENIGN, DoS, PortScan, BruteForce, Infiltration, Web Attack, Bot, DDoS, Heartbleed. These must be mapped to Providence's taxonomy: BENIGN, DOS, PROBE, BRUTE_FORCE, INJECTION, EXFILTRATION. AI_AGENT is excluded from CICIDS training (no ground truth — that's Phase 6).

### Honeypot Data

The Lure has been collecting real attack traffic since Phase 0 across 3 AWS regions. Normalization scripts (`scripts/normalize/`) convert Cowrie/Dionaea logs to Providence's unified event schema. Honeypot data provides labeled BRUTE_FORCE, PROBE, and some DOS samples from 2026.

---

## Tasks

### Task 1: Project Setup & Feature Schema

**Requirements:**
- [ ] Initialize `ml/` Python project with `pyproject.toml`:
  - Python ≥ 3.11
  - Dependencies: scikit-learn, xgboost, lightgbm, pandas, numpy, matplotlib, seaborn, protobuf, joblib, pytest, jupyter
  - No PyTorch yet (that's Phase 6)
- [ ] Create package structure:
  ```
  ml/
  ├── pyproject.toml
  ├── src/
  │   ├── __init__.py
  │   ├── server.py
  │   ├── models/
  │   │   ├── __init__.py
  │   │   ├── random_forest.py
  │   │   ├── gradient_boosted.py
  │   │   └── model_registry.py
  │   ├── training/
  │   │   ├── __init__.py
  │   │   ├── train_classifier.py
  │   │   └── hyperparameter_search.py
  │   ├── evaluation/
  │   │   ├── __init__.py
  │   │   ├── evaluate.py
  │   │   └── benchmark.py
  │   ├── data/
  │   │   ├── __init__.py
  │   │   ├── cicids_loader.py
  │   │   ├── honeypot_loader.py
  │   │   └── preprocessor.py
  │   └── features/
  │       ├── __init__.py
  │       └── schema.py
  ├── tests/
  │   ├── __init__.py
  │   ├── test_models.py
  │   ├── test_inference.py
  │   └── test_data_loaders.py
  ├── notebooks/
  │   ├── 01_eda_cicids.ipynb
  │   └── 02_model_comparison.ipynb
  └── Dockerfile
  ```
- [ ] `features/schema.py` — Define **two** feature sets, not one:

  **`INTERSECTION_FEATURES`** — Features that both CICIDS and The Eye compute with genuinely equivalent semantics. This is the training feature set for the CICIDS baseline model. Only features with clean, unambiguous mappings between CICIDS column names and Eye FlowStats fields belong here:
  ```python
  INTERSECTION_FEATURES = [
      "flow_duration",         # CICIDS: Flow Duration
      "packet_count_fwd",      # CICIDS: Total Fwd Packets
      "packet_count_bwd",      # CICIDS: Total Backward Packets
      "bytes_fwd",             # CICIDS: Total Length of Fwd Packets
      "bytes_bwd",             # CICIDS: Total Length of Bwd Packets
      "packets_per_sec",       # CICIDS: Flow Packets/s
      "bytes_per_sec",         # CICIDS: Flow Bytes/s
      "syn_count",             # CICIDS: SYN Flag Count
      "ack_count",             # CICIDS: ACK Flag Count
      "fin_count",             # CICIDS: FIN Flag Count
      "rst_count",             # CICIDS: RST Flag Count
      "psh_count",             # CICIDS: Fwd PSH Flags (partial — fwd only in CICIDS)
      "urg_count",             # CICIDS: URG Flag Count
      "payload_size_mean",     # CICIDS: Average Packet Size
      "packet_count",          # CICIDS: Total Fwd + Total Bwd (derived)
      "total_bytes",           # CICIDS: Total Length Fwd + Bwd (derived)
  ]
  ```

  **`EYE_FULL_FEATURES`** — The complete feature set that The Eye extracts, including fields CICIDS doesn't have. This is the training feature set for the honeypot-trained model (where data flows through The Eye's actual pipeline):
  ```python
  EYE_FULL_FEATURES = INTERSECTION_FEATURES + [
      "window_size_min",
      "window_size_max",
      "window_size_mean",
      "payload_entropy_mean",
      "payload_size_min",
      "payload_size_max",
      "zero_payload_count",
      "ttl",
      "cipher_suite_count",
      "extension_count",
      "inter_arrival_mean",
      "inter_arrival_std",
      "inter_arrival_min",
      "inter_arrival_max",
      "syn_ack_ratio",
  ]
  # Note: ja3_hash is a string field — handled separately as a categorical feature or dropped
  ```

  Include:
  - A mapping function: `cicids_row → numpy array` using only `INTERSECTION_FEATURES`
  - A mapping function: `protobuf FeatureVector → numpy array` using `EYE_FULL_FEATURES`
  - A validation function that asserts a DataFrame's columns match a given feature set

- [ ] Generate Python protobuf stubs from `proto/features.proto` and `proto/event.proto` (use `grpcio-tools` or `protoc`)

**Acceptance criteria:**
- `pip install -e .` succeeds
- `python -c "from src.features.schema import INTERSECTION_FEATURES, EYE_FULL_FEATURES; print(len(INTERSECTION_FEATURES), len(EYE_FULL_FEATURES))"` prints both counts
- `INTERSECTION_FEATURES` is a strict subset of `EYE_FULL_FEATURES`
- Protobuf stubs importable: `from proto import features_pb2, event_pb2`

---

### Task 2: CICIDS Data Loading & EDA

**Requirements:**
- [ ] `data/cicids_loader.py`:
  - Load CICIDS2017 CSV files (multiple files, one per day/attack type)
  - Handle encoding issues (some files have non-UTF-8 characters)
  - Strip whitespace from column names (CICIDS CSVs have inconsistent spacing)
  - Drop rows with `NaN` or `Inf` in numeric columns (known data quality issue)
  - Map CICIDS labels to Providence taxonomy:
    ```
    BENIGN → BENIGN
    DoS Hulk, DoS GoldenEye, DoS Slowhttptest, DoS slowloris, DDoS → DOS
    PortScan → PROBE
    FTP-Patator, SSH-Patator → BRUTE_FORCE
    Web Attack – Brute Force, Web Attack – XSS, Web Attack – Sql Injection → INJECTION
    Infiltration → EXFILTRATION
    Bot → EXFILTRATION
    Heartbleed → INJECTION
    ```
  - Return: `(X: pd.DataFrame, y: pd.Series)` with Providence category labels
  - Print class distribution summary on load

- [ ] `data/cicids_loader.py` — also support CICIDS2018 (CSE-CIC-IDS2018) if available. Same loader logic with different file structure.

- [ ] **Intersection-only feature extraction** in `data/preprocessor.py`:
  - Map CICIDS column names → `INTERSECTION_FEATURES` from `schema.py`
  - Only include features with clean, unambiguous semantic equivalence:
    ```
    Flow Duration               → flow_duration
    Total Fwd Packets           → packet_count_fwd
    Total Backward Packets      → packet_count_bwd
    Total Length of Fwd Packets  → bytes_fwd
    Total Length of Bwd Packets  → bytes_bwd
    Flow Bytes/s                → bytes_per_sec
    Flow Packets/s              → packets_per_sec
    SYN Flag Count              → syn_count
    ACK Flag Count              → ack_count
    FIN Flag Count              → fin_count
    RST Flag Count              → rst_count
    Fwd PSH Flags               → psh_count
    URG Flag Count              → urg_count
    Average Packet Size         → payload_size_mean
    (Total Fwd + Bwd Packets)   → packet_count (derived)
    (Total Length Fwd + Bwd)    → total_bytes (derived)
    ```
  - **Do NOT force approximate mappings.** These CICIDS columns are explicitly excluded because they don't map cleanly to Eye fields:
    - `Init_Win_bytes_forward/backward` — CICIDS computes initial window from handshake only; The Eye tracks min/max/sum across all packets. Different semantics.
    - `min_seg_size_forward` — segment size ≠ payload size. Different measurement.
    - Any CICIDS feature that The Eye doesn't extract at all (subflow counts, bulk rates, idle time features, header lengths, etc.)
  - **Do NOT zero-fill missing features.** The CICIDS baseline model trains only on `INTERSECTION_FEATURES`. Zero-filled columns would be dead features that add noise and false train/serve alignment.
  - Return: DataFrame with only `INTERSECTION_FEATURES` columns
  - Document in a `FEATURE_ALIGNMENT.md` (or section of MODEL_EVALUATION.md): which features were included, which were excluded, and why

- [ ] `notebooks/01_eda_cicids.ipynb`:
  - Class distribution bar chart
  - Feature correlation heatmap (across `INTERSECTION_FEATURES`)
  - Per-class feature distributions (box plots for top discriminative features)
  - Class imbalance analysis — note BENIGN dominance
  - Missing/infinite value audit
  - Summary statistics table
  - **New:** Side-by-side column listing — all CICIDS columns vs `INTERSECTION_FEATURES` vs dropped columns, with rationale

**Acceptance criteria:**
- Loader successfully reads CICIDS2017 CSVs and returns features matching `INTERSECTION_FEATURES`
- No approximate or zero-filled features in the output — only clean mappings
- EDA notebook runs end-to-end and generates all described visualizations
- No `Inf` or `NaN` values survive preprocessing (replaced or dropped)

---

### Task 3: Honeypot Data Loading & Two-Model Strategy

**Design rationale:** CICIDS data never touched The Eye's pipeline, so training on it produces a baseline model limited to the feature intersection. Honeypot data that flows through The Eye's actual capture → extract path produces feature vectors with the *full* Eye feature set — including entropy, JA3 fields, window stats, and inter-arrival timing that CICIDS doesn't have. This enables a second, richer model trained on features the baseline can't use.

**Requirements:**
- [ ] `data/honeypot_loader.py` — **two loading modes:**

  **Mode A: Raw honeypot logs (session-level, limited features)**
  - Read normalized honeypot JSON/Parquet from `scripts/normalize/` output
  - Extract what flow-level features are available from session metadata:
    - `duration_seconds` → `flow_duration`
    - `attempts_in_session` → `packet_count` (approximate)
    - `inter_attempt_ms` → `inter_arrival_mean`, `inter_arrival_std`, `inter_arrival_min`, `inter_arrival_max`
  - Assign labels from the `category` field (already labeled: BRUTE_FORCE, PROBE, etc.)
  - These only cover a subset of `INTERSECTION_FEATURES` — suitable for supplementing the CICIDS baseline but not for training the full-feature model
  - Return `(X: pd.DataFrame, y: pd.Series)` aligned to `INTERSECTION_FEATURES`

  **Mode B: Eye-processed honeypot pcaps (full features)**
  - Load feature vectors that were captured by The Eye while monitoring honeypot traffic (or replayed pcaps through The Eye)
  - These are saved as JSON or protobuf from The Eye's export path and contain all `EYE_FULL_FEATURES`
  - Labels assigned by matching flow timestamps/IPs against honeypot session logs
  - Return `(X: pd.DataFrame, y: pd.Series)` aligned to `EYE_FULL_FEATURES`
  - If no Eye-processed data exists yet, this loader should return empty and log a warning — the full-feature model is deferred until enough Eye-processed data is collected

- [ ] `data/preprocessor.py` — unified preprocessing pipeline:
  - `fit_transform(X_train, feature_set)` / `transform(X_test, feature_set)`:
    - `feature_set` param selects `INTERSECTION_FEATURES` or `EYE_FULL_FEATURES`
    1. Replace `Inf` with `NaN`, then impute `NaN` with column median
    2. StandardScaler on all numeric features (zero mean, unit variance)
    3. Save scaler parameters for inference server to use
  - `combine_datasets(*dataset_tuples)`:
    - Concatenate multiple (X, y) pairs
    - Add `data_source` column for provenance tracking (not a model feature)
    - Handle class imbalance: use `class_weight='balanced'` in tree models (simplest, no synthetic data artifacts)
  - Save fitted preprocessor to disk via joblib alongside model artifacts
  - **Two preprocessors saved**: `preprocessor_intersection_v1.joblib` and `preprocessor_full_v1.joblib`

- [ ] Document the two-model strategy in `docs/MODEL_EVALUATION.md`:
  - **Model A (CICIDS Baseline):** Trained on `INTERSECTION_FEATURES` using CICIDS + raw honeypot data. Provides the initial classification capability. No train/serve skew because the model only uses features both sources compute identically.
  - **Model B (Eye-Native):** Trained on `EYE_FULL_FEATURES` using data captured by The Eye's actual pipeline. More discriminative (entropy, JA3, window stats). Deployed once sufficient Eye-processed data is collected. Initially may be deferred.

**Acceptance criteria:**
- Honeypot loader Mode A reads normalized data and returns `INTERSECTION_FEATURES`-aligned output
- Honeypot loader Mode B loads Eye-exported data or returns empty gracefully
- Preprocessor handles both feature sets without confusion
- Two separate preprocessor artifacts saved to disk
- Combined dataset has correct label distribution and source tracking
- Preprocessor serializes and deserializes correctly via joblib

---

### Task 4: Model Training

**Requirements:**
- [ ] `training/train_classifier.py` — CLI script with two training modes:

  **Mode: `--feature-set intersection` (default, runs first)**
  1. Loads CICIDS data via cicids_loader, optionally honeypot Mode A data
  2. Extracts only `INTERSECTION_FEATURES`
  3. Preprocesses via preprocessor (fit on train, transform on test)
  4. Stratified train/test split (80/20) preserving class ratios
  5. Trains models:
     - **Random Forest** (scikit-learn): 200 trees, `class_weight='balanced'`, `n_jobs=-1`
     - **XGBoost**: `multi:softprob` objective, sample weights for imbalance, 300 rounds, early stopping on validation set
     - **LightGBM**: `multiclass` objective, `is_unbalance=True`, 300 rounds, early stopping
  6. Saves to `ml/models/saved/`:
     - `random_forest_intersection_v1.joblib`
     - `xgboost_intersection_v1.joblib`
     - `lightgbm_intersection_v1.joblib`
     - `preprocessor_intersection_v1.joblib`
  7. Prints summary: training time, test accuracy, macro F1

  **Mode: `--feature-set full` (runs when Eye-processed data is available)**
  1. Loads honeypot Mode B data (Eye-processed pcaps with full feature vectors)
  2. Extracts `EYE_FULL_FEATURES`
  3. Same training pipeline, saves separate artifacts:
     - `xgboost_full_v1.joblib`
     - `preprocessor_full_v1.joblib`
  4. If insufficient Eye-processed data (< 1000 samples), print warning and skip. This model is expected to be deferred until later in the project when enough data has been collected through The Eye.

- [ ] `training/hyperparameter_search.py` — Optional but recommended:
  - RandomizedSearchCV on the best-performing intersection model
  - Search space: n_estimators, max_depth, min_samples_split (RF) or learning_rate, max_depth, subsample (XGB/LGBM)
  - 5-fold stratified CV
  - Save best params to JSON

- [ ] `models/model_registry.py`:
  - `ModelRegistry` class that manages versioned model files in `ml/models/saved/`
  - `load(model_name, version)` → returns (model, preprocessor, feature_set_name) tuple
  - `list_models()` → returns available model names, versions, and which feature set they use
  - `get_active()` → returns currently active model (reads from `active_model.json` config)
  - `set_active(model_name, version)` → updates `active_model.json`
  - Default active model: best-performing intersection model (since full-feature model may not exist yet)
  - The registry must track which feature set each model expects so the inference server knows whether to extract `INTERSECTION_FEATURES` or `EYE_FULL_FEATURES` from incoming protobuf

**Acceptance criteria:**
- `python -m src.training.train_classifier --data-dir /path/to/cicids --feature-set intersection` runs end-to-end
- Three intersection model files and one preprocessor file saved to `ml/models/saved/`
- Each intersection model achieves >90% accuracy on the test set (CICIDS is relatively clean)
- ModelRegistry can load any saved model and return predictions
- ModelRegistry tracks which feature set each model expects
- Full-feature training gracefully skips if insufficient Eye-processed data

---

### Task 5: Model Evaluation

**Requirements:**
- [ ] `evaluation/evaluate.py` — generates comprehensive evaluation report:
  - Per-category precision, recall, F1-score (from `classification_report`)
  - Overall accuracy, macro-averaged F1, weighted-averaged F1
  - Confusion matrix (normalized and raw counts)
  - Per-category ROC curves and AUC scores (one-vs-rest)
  - Feature importance ranking (top features for each model — note: intersection models only use `INTERSECTION_FEATURES`)
  - Comparison table: RF vs XGBoost vs LightGBM side by side
  - Save all plots to `ml/evaluation/plots/`
  - Save metrics to `ml/evaluation/metrics.json`

- [ ] `evaluation/benchmark.py` — inference latency benchmarks:
  - Single-sample inference time (median over 1000 runs)
  - Batch inference time (100, 1000, 10000 samples)
  - Memory footprint of loaded model
  - Target: single inference < 5ms (well within the 500ms socket timeout)

- [ ] `notebooks/02_model_comparison.ipynb`:
  - Side-by-side confusion matrices
  - Per-category F1 bar chart across models
  - Feature importance comparison
  - ROC curve overlay
  - Recommendation for which model to deploy and why

- [ ] `docs/MODEL_EVALUATION.md`:
  - Dataset description: CICIDS2017/2018 source, size, date, known limitations
  - Providence taxonomy mapping with rationale
  - **Two-model strategy explanation:**
    - Why intersection-only: avoiding train/serve skew, honest about what maps cleanly
    - Which CICIDS columns map to `INTERSECTION_FEATURES`, which were excluded, and why each exclusion was made (different semantics, not equivalent measurement, etc.)
    - Eye-native model roadmap: what additional features it will use, what data it needs, when it becomes available
  - Training methodology: split strategy, class imbalance handling, hyperparameters
  - Results tables: per-category P/R/F1 for each intersection model
  - Confusion matrices (embedded images or ASCII)
  - Feature importances (within the intersection feature set)
  - Model selection rationale
  - Inference latency benchmarks
  - **Honest limitations section:**
    - CICIDS2017/2018 is from 2017–2018; modern attack patterns may differ
    - Intersection feature set is smaller than The Eye's full capability — some discriminative features (entropy, JA3, window behavior) are unused until the full-feature model is trained
    - Honeypot data supplements with 2026 traffic but has limited feature coverage in Mode A
    - No AI_AGENT training data yet (Phase 6)
    - INJECTION detection limited to unencrypted HTTP
    - Model has not been validated on live network traffic until the end-to-end test

**Acceptance criteria:**
- `python -m src.evaluation.evaluate --model xgboost_intersection_v1` generates all plots and metrics
- MODEL_EVALUATION.md is complete with all sections listed above
- Inference benchmark confirms < 5ms per prediction
- Honest limitations section is present and substantive (not boilerplate)

---

### Task 6: Inference Server

**Requirements:**
- [ ] `server.py` — Unix domain socket inference server:
  - Listens on `AF_UNIX`, `SOCK_STREAM` at `/tmp/providence_ml.sock` (configurable via `--socket-path`)
  - Wire protocol (matches The Eye's `MlClient`):
    1. Read 4-byte big-endian length prefix
    2. Read `length` bytes of serialized `FeatureVector` protobuf
    3. Deserialize into feature array using `schema.py`
    4. Preprocess using fitted preprocessor (loaded at startup)
    5. Run model prediction → `(category, confidence, feature_importances)`
    6. Serialize `Classification` protobuf response
    7. Write 4-byte big-endian length prefix + serialized response
  - On startup:
    - Load active model, preprocessor, and **feature set name** from ModelRegistry
    - Remove stale socket file if exists
    - Bind and listen (backlog 5)
    - Log: model name, version, feature set (`INTERSECTION_FEATURES` or `EYE_FULL_FEATURES`), feature count, socket path
  - Feature extraction from incoming protobuf:
    - Always receives full `FeatureVector` protobuf from The Eye (all fields populated)
    - Extracts only the features matching the active model's feature set (intersection or full)
    - This means the server works correctly with either model tier — the protobuf carries all fields, the server picks the subset it needs
  - Connection handling:
    - Accept connections in a loop
    - Each connection can send multiple requests (persistent connection)
    - Handle partial reads (loop until full message received)
    - Handle client disconnect gracefully (don't crash)
    - Log each prediction at DEBUG level (category, confidence)
  - Graceful shutdown on SIGINT/SIGTERM: close socket, remove socket file

- [ ] `Classification` protobuf response must include:
  - `category`: predicted class (BENIGN, DOS, PROBE, etc.)
  - `subcategory`: empty string for now (Phase 6 adds granularity)
  - `confidence`: probability of predicted class (from `predict_proba`)
  - `feature_importances`: map of feature name → importance value (top 10 only, to keep message small)

- [ ] `models/random_forest.py` and `models/gradient_boosted.py`:
  - Thin wrapper classes with a common interface:
    ```python
    class ProvidenceModel:
        def predict(self, features: np.ndarray) -> tuple[str, float, dict[str, float]]:
            """Returns (category, confidence, feature_importances)"""
    ```
  - Load from joblib
  - `predict_proba` → pick highest probability class
  - Feature importances from model's `.feature_importances_` attribute

**Acceptance criteria:**
- Server starts, prints loaded model info, listens on socket
- `tests/mock_ml_client.py` (Python equivalent of The Eye's C++ client) sends a FeatureVector and receives a valid Classification
- Server handles 100 sequential requests without error
- Server handles client disconnect mid-request without crashing
- Server shuts down cleanly on SIGINT (socket file removed)

---

### Task 7: Eye Integration — Wiring the Processor Loop

**Requirements:**

This task modifies C++ code in `eye/`. The Eye's `MlClient` and `GrpcDispatcher` exist but are not called from the processor loop. They need to be wired in.

- [ ] **Update `proto/event.proto` compatibility:**
  - The Eye's `grpc_dispatcher.cpp` was coded against Phase 1's proto
  - Update to use Phase 2's `ReportEvent` RPC and flattened `ClassifiedEvent` fields:
    - `source_ip`, `source_port`, `dest_ip`, `dest_port`, `protocol` (flattened, not nested)
    - `source_component = "eye"`
    - `confidence` as `float` (not `double`)
    - `ja3_hash`, `flow_duration`, `packet_count`, `byte_count` populated from flow stats
  - Rebuild protobuf/gRPC stubs via CMake

- [ ] **Add flow completion trigger logic to `processor.cpp`:**
  - Define "flow complete" heuristic: FIN+ACK seen on both directions, OR RST received, OR inactivity timeout (configurable, default 30 seconds since last packet)
  - When a flow completes:
    1. Build `FeatureVector` protobuf from `FlowStats`
    2. Call `MlClient::classify(feature_vector)` → `std::optional<Classification>`
    3. If classification received:
       - Build `ClassifiedEvent` protobuf from flow stats + classification
       - Call `GrpcDispatcher::dispatch(classified_event)`
       - Log: flow key, category, confidence
    4. If ML service unavailable (nullopt): log warning, continue capture (never crash)
    5. Evict completed flow from the flow table

- [ ] **Add inactivity timeout sweep:**
  - Periodic check (every 5 seconds) for flows with `last_seen` older than timeout threshold
  - Timed-out flows treated as completed: classify and dispatch, then evict
  - This addresses the Phase 1 known limitation: "Flows accumulate indefinitely; needs eviction policy"

- [ ] **FeatureVector population from FlowStats:**
  Map all FlowStats fields to FeatureVector protobuf fields:
  ```
  flow_duration        = last_seen - first_seen (seconds)
  packet_count         = stats.packet_count
  packet_count_fwd     = stats.packet_count_fwd
  packet_count_bwd     = stats.packet_count_bwd
  total_bytes          = stats.total_bytes
  bytes_fwd            = stats.bytes_fwd
  bytes_bwd            = stats.bytes_bwd
  syn_count            = stats.syn_count
  ack_count            = stats.ack_count
  fin_count            = stats.fin_count
  rst_count            = stats.rst_count
  psh_count            = stats.psh_count
  urg_count            = stats.urg_count
  window_size_min      = stats.window_size_min
  window_size_max      = stats.window_size_max
  window_size_mean     = stats.window_size_sum / stats.packet_count
  payload_entropy_mean = stats.entropy_sum / stats.entropy_count (or 0)
  payload_size_min     = stats.payload_size_min
  payload_size_max     = stats.payload_size_max
  payload_size_mean    = stats.payload_size_sum / stats.payload_count (or 0)
  zero_payload_count   = stats.zero_payload_count
  ttl                  = stats.ttl
  ja3_hash             = stats.ja3_hash (string field)
  cipher_suite_count   = stats.cipher_suite_count
  extension_count      = stats.extension_count
  inter_arrival_mean/std/min/max = computed from stats.timestamps
  packets_per_sec      = packet_count / duration
  bytes_per_sec        = total_bytes / duration
  syn_ack_ratio        = syn_count / ack_count (or 0)
  ```

**Acceptance criteria:**
- Eye compiles with updated proto stubs (`cmake --build build`)
- All existing tests still pass (`ctest --output-on-failure`)
- With ML server running, Eye classifies completed flows and logs `[CLASSIFY] flow_key → CATEGORY (confidence)`
- With Citadel running, classified events appear in the Citadel's PostgreSQL database
- With ML server down, Eye continues capturing without crashing (logs warning)
- Timed-out flows are evicted and classified

---

### Task 8: End-to-End Integration Test

**Requirements:**
- [ ] Create `scripts/e2e_test.sh` that orchestrates the full pipeline:
  1. Start PostgreSQL + Redis via Docker Compose (or Testcontainers)
  2. Start The Citadel (`docker-compose up citadel`)
  3. Start the ML inference server (`python -m src.server --socket-path /tmp/providence_ml.sock`)
  4. Start The Eye on loopback (`./eye lo0` on macOS or `lo` on Linux)
  5. Generate test traffic:
     - `curl http://example.com` (benign HTTP)
     - `nmap -sS localhost` (port scan → PROBE) — or use `hping3` for SYN flood
     - Simulated brute force: rapid SSH connection attempts
  6. Wait 10 seconds for flows to complete and classify
  7. Query Citadel REST API: `GET /api/v1/events`
  8. Assert: at least one event stored, with non-empty category and confidence
  9. Tear down all services

- [ ] Create `tests/test_inference.py`:
  - Unit test: construct a FeatureVector protobuf, serialize it, send to server via Unix socket, deserialize Classification response
  - Unit test: send malformed data → server doesn't crash, returns error or closes connection
  - Unit test: send 100 sequential requests → all return valid classifications
  - Unit test: verify feature ordering matches between schema.py and protobuf deserialization for both `INTERSECTION_FEATURES` and `EYE_FULL_FEATURES`

- [ ] Create `tests/test_data_loaders.py`:
  - Unit test: cicids_loader returns correct column count matching `INTERSECTION_FEATURES`
  - Unit test: preprocessor handles NaN/Inf correctly
  - Unit test: label mapping produces only valid Providence categories
  - Unit test: preprocessor fit/transform is deterministic (same input → same output)

- [ ] Create `tests/test_models.py`:
  - Unit test: ModelRegistry loads saved model successfully
  - Unit test: loaded model predicts on a single sample without error
  - Unit test: model returns valid category string from the taxonomy
  - Unit test: confidence is in [0.0, 1.0] range
  - Unit test: feature importances dict has string keys and float values

**Acceptance criteria:**
- `scripts/e2e_test.sh` runs and exits 0 with at least one classified event in Citadel
- `pytest ml/tests/` passes all tests
- End-to-end latency: traffic generation → event in Citadel < 30 seconds

---

### Task 9: Docker & CI

**Requirements:**
- [ ] `ml/Dockerfile`:
  ```dockerfile
  FROM python:3.12-slim

  WORKDIR /app

  # Install protobuf compiler
  RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler && rm -rf /var/lib/apt/lists/*

  # Install Python dependencies
  COPY pyproject.toml .
  RUN pip install --no-cache-dir -e .

  # Copy source and proto
  COPY src/ src/
  COPY ../proto/ proto/

  # Generate protobuf stubs
  RUN protoc --python_out=src/ proto/*.proto

  # Copy pre-trained models
  COPY models/saved/ models/saved/

  EXPOSE 50052

  CMD ["python", "-m", "src.server", "--socket-path", "/tmp/providence_ml.sock"]
  ```
  - Note: For Docker deployment the socket path may need to be a shared volume mount between Eye and ML containers, or switch to TCP for containerized setups. Document both options.

- [ ] Update `docker-compose.yml` to add ML service:
  ```yaml
  ml-service:
    build: ./ml
    volumes:
      - ml-socket:/tmp
    depends_on:
      - citadel
  ```
  - Eye container mounts the same volume for the Unix socket

- [ ] Create or update `.github/workflows/ci-ml.yml`:
  ```yaml
  name: CI — ML Pipeline
  on:
    push:
      paths: ['ml/**', 'proto/features.proto', 'proto/event.proto']
    pull_request:
      paths: ['ml/**', 'proto/**']

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with:
            python-version: '3.12'
        - name: Install dependencies
          run: cd ml && pip install -e '.[test]'
        - name: Generate proto stubs
          run: protoc --python_out=ml/src/ proto/*.proto
        - name: Run tests
          run: cd ml && pytest tests/ -v
        - name: Lint
          run: cd ml && ruff check src/ tests/
  ```
  - CI does NOT run model training (too slow, needs data). Tests use small synthetic data.
  - CI DOES run unit tests for loaders, preprocessor, model loading, and inference.

**Acceptance criteria:**
- `docker build -t providence-ml ml/` succeeds
- ML service starts in Docker and listens on socket
- CI pipeline passes on push to `ml/` or `proto/`

---

## Scoped Out (Future Phases)

| Item | Phase |
|---|---|
| AI_AGENT detection (LSTM/1D CNN, synthetic data generation) | Phase 6 |
| Shadow scoring / hot swap / rollback model deployment | Phase 6+ (scaffold model_registry now) |
| Drift detection (`drift_detector.py`) | Phase 6 |
| Online learning from analyst feedback | Stretch |
| Cloud feature schema adaptation for The Oracle | Phase 7 |
| Model management API on Citadel (`/models`, `/swap`, `/rollback`) | Phase 6 |
| Full-feature model training (requires sufficient Eye-processed pcap data) | Ongoing data collection; train when ≥1000 labeled Eye-processed flows available |

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                     THE EYE (C++)                            │
│                                                              │
│  pcap_loop ──▶ ring_buffer ──▶ processor                    │
│                                    │                         │
│                          ┌─────────┼──────────┐              │
│                          ▼         ▼          ▼              │
│                     flow_tracker  tls_parser  dns_parser     │
│                          │                                    │
│                    [flow complete?]                           │
│                          │ yes                                │
│                          ▼                                    │
│                 build FeatureVector (protobuf)                │
│                          │                                    │
│                          ▼                                    │
│              ┌───────────────────────┐                       │
│              │ MlClient (Unix sock)  │───────────────────┐   │
│              │ /tmp/providence_ml.sock│                   │   │
│              └───────────────────────┘                   │   │
│                          │                               │   │
│                   Classification                         │   │
│                          │                               │   │
│                          ▼                               │   │
│              ┌───────────────────────┐                   │   │
│              │ GrpcDispatcher        │                   │   │
│              │ → Citadel:50051       │                   │   │
│              └───────────────────────┘                   │   │
└──────────────────────────────────────────────────────────┘   │
                                                               │
                    ┌──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────┐
│        ML INFERENCE SERVICE          │
│            (Python)                  │
│                                      │
│  Unix socket server                  │
│  ├── Receive FeatureVector           │
│  ├── Preprocess (fitted scaler)      │
│  ├── Model.predict_proba()           │
│  └── Return Classification           │
│                                      │
│  ModelRegistry                       │
│  ├── random_forest_intersection_v1   │
│  ├── xgboost_intersection_v1         │
│  ├── lightgbm_intersection_v1        │
│  ├── preprocessor_intersection_v1    │
│  ├── xgboost_full_v1 (when ready)    │
│  └── preprocessor_full_v1 (when ready)│
└──────────────────────────────────────┘
```

---

## Verification Checklist

When Phase 3 is complete, all of the following must be true:

- [ ] CICIDS2017 data loads, preprocesses, and produces only `INTERSECTION_FEATURES` (no approximate mappings, no zero-fills)
- [ ] Honeypot data loads in Mode A (raw logs → intersection features) and Mode B (Eye-processed → full features, or empty if no data yet)
- [ ] Three intersection models trained (Random Forest, XGBoost, LightGBM), saved to disk
- [ ] Full-feature model training runs or gracefully defers if insufficient data
- [ ] MODEL_EVALUATION.md complete with two-model strategy explanation, metrics, confusion matrices, honest limitations
- [ ] Inference server runs, accepts FeatureVector protobufs, returns Classification protobufs
- [ ] Inference latency < 5ms per prediction
- [ ] The Eye's processor calls MlClient on flow completion
- [ ] The Eye's GrpcDispatcher updated for Phase 2 proto contract
- [ ] Classified events flow from Eye → ML Service → Eye → Citadel → PostgreSQL
- [ ] The Eye handles ML service unavailability gracefully (no crash)
- [ ] Flow timeout eviction implemented (no more infinite accumulation)
- [ ] `pytest ml/tests/` passes all unit tests
- [ ] End-to-end test script validates the full pipeline
- [ ] Docker build succeeds for ML service
- [ ] CI pipeline passes on push to `ml/` or `proto/`
- [ ] EDA notebook runs end-to-end with visualizations
