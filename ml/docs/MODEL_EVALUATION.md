# Providence ML — Model Evaluation

## Dataset

### CICIDS2017
- Source: Canadian Institute for Cybersecurity, University of New Brunswick
- Capture period: July 3–7, 2017
- Contains labeled network flow features from simulated attack scenarios
- Known limitations: synthetic environment, 2017-era attack patterns, class imbalance (BENIGN dominant)

### Honeypot Data (The Lure)
- Source: Providence honeypot infrastructure across 3 AWS regions
- Collection period: February–April 2026 (ongoing)
- **282,863 sessions** (183,933 BRUTE_FORCE, 92,726 PROBE, 6,204 EXFILTRATION)
- Two modes: raw session logs (limited features) and Eye-processed pcaps (full features)

## Providence Taxonomy Mapping

| CICIDS Label | Providence Category | Rationale |
|---|---|---|
| BENIGN | BENIGN | Direct mapping |
| DoS Hulk, DoS GoldenEye, DoS Slowhttptest, DoS slowloris, DDoS | DOS | All denial-of-service variants |
| PortScan | PROBE | Network reconnaissance |
| FTP-Patator, SSH-Patator | BRUTE_FORCE | Credential stuffing attacks |
| Web Attack (Brute Force, XSS, SQL Injection) | INJECTION | Application-layer attacks |
| Infiltration, Bot | EXFILTRATION | Data exfiltration / C2 communication |
| Heartbleed | INJECTION | Protocol-level exploitation |

AI_AGENT is excluded from CICIDS training — no ground truth exists. Phase 6 addresses this with synthetic data generation and LSTM/1D CNN models.

## Two-Model Strategy

### Model A: CICIDS Baseline (Intersection Features)

Trained on `INTERSECTION_FEATURES` — the 16 features with clean, unambiguous semantic equivalence between CICIDS column names and Eye FlowStats fields.

**Why intersection-only:** CICIDS data never touched The Eye's pipeline. The Eye computes features from raw packets; CICIDS provides pre-computed flow statistics. Only features where both sources measure the same thing with the same semantics are included. This avoids train/serve skew — the model trains on exactly the features it will see at inference time.

**Included features (16):**
| Providence Feature | CICIDS Column | Mapping Quality |
|---|---|---|
| flow_duration | Flow Duration | Exact |
| packet_count_fwd | Total Fwd Packets | Exact |
| packet_count_bwd | Total Backward Packets | Exact |
| bytes_fwd | Total Length of Fwd Packets | Exact |
| bytes_bwd | Total Length of Bwd Packets | Exact |
| packets_per_sec | Flow Packets/s | Exact |
| bytes_per_sec | Flow Bytes/s | Exact |
| syn_count | SYN Flag Count | Exact |
| ack_count | ACK Flag Count | Exact |
| fin_count | FIN Flag Count | Exact |
| rst_count | RST Flag Count | Exact |
| psh_count | Fwd PSH Flags | Partial (fwd only in CICIDS) |
| urg_count | URG Flag Count | Exact |
| payload_size_mean | Average Packet Size | Exact |
| packet_count | Total Fwd + Bwd (derived) | Exact |
| total_bytes | Total Length Fwd + Bwd (derived) | Exact |

**Excluded CICIDS columns and rationale:**
| CICIDS Column | Reason for Exclusion |
|---|---|
| Init_Win_bytes_forward/backward | CICIDS computes initial window from handshake only; Eye tracks min/max/sum across all packets. Different semantics. |
| min_seg_size_forward | Segment size ≠ payload size. Different measurement. |
| Subflow Fwd/Bwd Bytes/Packets | Eye does not compute subflow metrics. |
| Fwd/Bwd Header Length | Eye does not track header lengths separately. |
| Idle Mean/Std/Min/Max | Eye does not compute idle time features. |
| Active Mean/Std/Min/Max | Eye does not compute active time features. |
| Fwd/Bwd Avg Bytes/Bulk, Bulk Rate | Eye does not compute bulk transfer metrics. |
| Down/Up Ratio | Eye does not compute this ratio. |

### Model B: Eye-Native (Full Features)

Trained on `EYE_FULL_FEATURES` — all 31 features The Eye extracts, including entropy, JA3, window stats, and inter-arrival timing that CICIDS doesn't have. Deployed once sufficient Eye-processed data is collected (target: ≥1000 labeled flows).

**Additional features (15 beyond intersection):**
window_size_min, window_size_max, window_size_mean, payload_entropy_mean, payload_size_min, payload_size_max, zero_payload_count, ttl, cipher_suite_count, extension_count, inter_arrival_mean, inter_arrival_std, inter_arrival_min, inter_arrival_max, syn_ack_ratio

These features are expected to be highly discriminative — payload entropy distinguishes encrypted/compressed traffic, JA3 fingerprints identify automated tools, window size patterns reveal OS and application behavior, inter-arrival timing exposes scanning patterns.

## Training Methodology

- Stratified 80/20 train/test split preserving class ratios
- Class imbalance handled via `class_weight='balanced'` (Random Forest) and sample weighting (XGBoost/LightGBM)
- No synthetic oversampling (SMOTE etc.) to avoid introducing artifacts
- StandardScaler preprocessing (zero mean, unit variance)
- NaN/Inf values imputed with column median

## Models Trained

| Model | Type | Feature Set | Trees/Rounds |
|---|---|---|---|
| random_forest_intersection_v1 | Random Forest | Intersection (16) | 200 trees |
| xgboost_intersection_v1 | XGBoost | Intersection (16) | 300 rounds |
| lightgbm_intersection_v1 | LightGBM | Intersection (16) | 300 rounds |

Results tables, confusion matrices, and feature importance plots are generated by `python -m src.evaluation.evaluate` and saved to `ml/evaluation/`.

## Inference Latency

Target: < 5ms per single-sample prediction (well within The Eye's 500ms socket timeout).

Benchmarks generated by `python -m src.evaluation.benchmark`.

## Honest Limitations

1. **Temporal gap:** CICIDS2017/2018 data is from 2017–2018. Modern attack patterns, tooling, and evasion techniques have evolved significantly. The model may underperform on 2026 traffic patterns it hasn't seen.

2. **Reduced feature set:** The intersection model uses only 16 of The Eye's 31 features. Discriminative features like payload entropy (encrypted vs plaintext), JA3 fingerprints (automated tool detection), and window size behavior (OS fingerprinting) are unused until the full-feature model is trained.

3. **Honeypot data limitations:** Mode A honeypot data provides session-level metadata, not packet-level features. Only a subset of intersection features can be populated. Mode B (Eye-processed) data is the path to the full-feature model but requires sufficient collection volume.

4. **No AI_AGENT detection:** No training data exists for AI agent traffic patterns. This is a Phase 6 concern requiring synthetic data generation and sequence models (LSTM/1D CNN).

5. **INJECTION detection limited:** CICIDS web attack samples are unencrypted HTTP. The model cannot detect injection attacks in TLS-encrypted traffic without decryption or behavioral side-channel features.

6. **Lab vs production gap:** The model has not been validated on live production network traffic until the end-to-end integration test. CICIDS is a controlled lab environment; real networks have different traffic distributions, noise levels, and edge cases.

7. **Class imbalance:** BENIGN traffic dominates both CICIDS and real networks. While balanced class weights help, the model may still exhibit higher false positive rates for rare attack categories (EXFILTRATION, INJECTION).
