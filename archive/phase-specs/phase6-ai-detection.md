# Phase 6: Adversarial AI Detection

> Providence Network Security Intelligence Platform
> Component: Experimental AI_AGENT Detection Module
> Timeline: Weeks 15–17
> Prerequisites: Phase 3 (ML Pipeline) complete, Phase 5 (The Lens) complete
> **This entire phase is explicitly experimental. No public ground truth exists.**

---

## Goal

Build a classifier that distinguishes LLM-driven automated attacks from human-driven attacks using behavioral sequence analysis. Generate synthetic AI_AGENT training data in a lab environment by running LLM-powered attack scripts against an isolated honeypot. Train a sequence model (LSTM or 1D CNN) on temporal and behavioral features. Integrate into Providence's classification taxonomy. Document methodology and limitations with total honesty.

---

## Deliverable

An experimental adversarial AI detection module with documented methodology. A labeled dataset (HUMAN vs AI_AGENT sessions). A trained sequence model. Integration into the ML inference service. AI-specific alerting on The Lens dashboard. An `AI_DETECTION.md` document that is upfront about what this can and cannot do.

---

## Context

### Why This Is Hard

No public dataset of "AI-agent attack traffic vs human attack traffic" exists. You're creating your own. This means:

- The AI_AGENT class is defined by *your* synthetic attack scripts. A different LLM, a different prompt, a different tool would produce different patterns. The model detects *your synthetic AI behavior*, not all possible AI behavior.
- The HUMAN class comes from honeypot data — real attackers, but they're mostly automated bots too (credential stuffing scripts, Mirai variants). The distinction is "traditional automation" vs "LLM-guided automation," which is subtle.
- This is a research contribution, not a production-grade detection system. Frame it that way.

### What You Have

**HUMAN data (from The Lure, Phase 0):**
- ~5,900+ sessions across 3 AWS regions since February 2026
- Per-session: timestamps, auth attempts with timing, commands executed, files downloaded, SSH client versions, HASSH fingerprints
- Normalized via `scripts/normalize/` into unified event schema
- Session metadata includes `inter_attempt_ms` arrays — the timing backbone for behavioral analysis

**What you need to generate:**
- AI_AGENT sessions: LLM-driven attack scripts running against an isolated honeypot in a lab, producing sessions with the same schema

### Behavioral Hypotheses (from design doc)

The model should learn to detect these differences:

| Feature | Human / Traditional Bot | LLM-Guided Agent |
|---|---|---|
| Inter-attempt timing | Bimodal: very fast (bot) or very slow (human typing) | Consistent latency reflecting LLM inference time (~1-5 seconds between actions) |
| Exploration strategy | Random or wordlist-sequential credential attempts | Semantically coherent: tries related passwords, adapts based on system responses |
| Adaptation after failure | Repeats same strategy or gives up | Changes approach: different username pattern, different service, different payload |
| Command sequences | Fixed scripts (same recon one-liner across sessions) | Context-aware: commands depend on previous output |
| Session structure | Short burst (bot) or long dwell (human) | Medium-length, methodical progression through attack phases |

---

## Tasks

### Task 1: Lab Environment Setup

**Requirements:**
- [ ] Create an isolated lab network for generating synthetic AI_AGENT data:
  - **Option A (Docker Compose — recommended for simplicity):**
    - `docker-compose.lab.yml` with two services on an isolated Docker network:
      1. `lab-honeypot`: Cowrie container (SSH honeypot) on port 22
      2. `lab-attacker`: Python container running LLM-driven attack scripts
    - No external network access from the attacker container (only reaches the honeypot)
  - **Option B (VMs on private subnet):**
    - Two VMs on a VPC private subnet
    - VM-1 runs Cowrie; VM-2 runs attack scripts
    - More realistic network behavior but more operational overhead

- [ ] Configure lab Cowrie to log in the same JSON format as production honeypots
- [ ] Verify lab honeypot accepts SSH connections and logs sessions identically to The Lure

**Acceptance criteria:**
- `docker-compose -f docker-compose.lab.yml up` starts honeypot + attacker
- SSH to lab honeypot from attacker container produces Cowrie JSON logs
- Log format matches production honeypot schema (same fields, same structure)

---

### Task 2: LLM-Driven Attack Scripts

**Requirements:**
- [ ] Create `ml/src/data/lab/` directory for synthetic data generation scripts
- [ ] `ssh_credential_guesser.py`:
  - Uses an LLM API (Anthropic Claude or OpenAI) to generate credential guesses
  - Prompt pattern: give the LLM context about the target (hostname, banner, previous failed attempts) and ask for next credentials to try
  - Executes SSH connection attempts via `paramiko` against the lab honeypot
  - Logs each attempt with timestamp (captures real LLM inference latency in the inter-attempt timing)
  - Runs for N sessions (configurable, default 100), each session is a burst of attempts from a "fresh" attacker perspective
  - Each session: connect → try credentials → optionally explore if login succeeds → disconnect

- [ ] `web_vuln_scanner.py` (if LURE-WEB is in the lab):
  - LLM generates HTTP payloads (SQL injection, XSS, path traversal attempts)
  - Sends requests via `requests` library to a DVWA or similar web honeypot
  - LLM receives response status/body and adapts next payload
  - Logs full request/response timing

- [ ] `adaptive_explorer.py`:
  - After successful auth on the SSH honeypot, LLM decides what commands to run
  - Prompt: "You've gained SSH access to a Linux server. Your goal is to assess what's valuable. Here's the output of your last command: {output}. What command do you run next?"
  - Executes commands via paramiko channel, feeds output back to LLM
  - Captures command sequence with timing between each command
  - This generates the "context-aware command sequences" that distinguish AI from scripted bots

- [ ] **Session output format** — each generated session saves a JSON file matching the normalized schema:
  ```json
  {
    "session_id": "lab-ai-001",
    "source": "lab-attacker",
    "src_ip": "172.20.0.3",
    "dst_port": 22,
    "protocol": "tcp",
    "category": "AI_AGENT",
    "session_metadata": {
      "duration_seconds": 45.2,
      "attempts_in_session": 8,
      "commands_executed": ["uname -a", "cat /etc/passwd", "ls -la /home", "find / -name '*.pem'"],
      "inter_attempt_ms": [2340, 1890, 3100, 2560, 1740, 2890, 3200],
      "llm_model": "claude-sonnet-4-20250514",
      "generation_timestamp": "2026-04-15T10:00:00Z"
    }
  }
  ```
  - Note the `llm_model` and `generation_timestamp` fields for provenance

- [ ] **Ethical guardrails:**
  - Attack scripts ONLY target the lab honeypot (hardcoded target IP, Docker network isolation)
  - LLM prompts do not ask for novel vulnerability research or zero-day generation
  - Scripts are clearly documented as defensive research tools
  - Code includes a prominent header: "FOR DEFENSIVE RESEARCH ONLY — generates synthetic data for training attack detection models"
  - The attack scripts themselves are NOT published in the repo's public documentation — only the detection model and methodology are public

- [ ] Generate at minimum:
  - 200 AI_AGENT SSH credential sessions
  - 100 AI_AGENT post-auth exploration sessions
  - 50 AI_AGENT web scanning sessions (if web honeypot available)

**Acceptance criteria:**
- `python ssh_credential_guesser.py --sessions 10 --target lab-honeypot` generates 10 session JSON files
- Session files match the normalized schema
- Inter-attempt timings reflect real LLM inference latency (typically 1-5 seconds, not milliseconds)
- `adaptive_explorer.py` produces context-aware command sequences (not hardcoded)

---

### Task 3: Dataset Assembly & Feature Engineering

**Requirements:**
- [ ] `ml/src/data/synthetic_loader.py`:
  - Load all lab-generated AI_AGENT session JSONs
  - Load all honeypot HUMAN session data (from `scripts/normalize/` output)
  - Combine into a single labeled dataset: `label ∈ {HUMAN, AI_AGENT}`

- [ ] **Behavioral feature extraction** — `ml/src/features/behavioral.py`:
  Extract per-session features designed to capture the behavioral hypotheses:

  **Timing features:**
  - `inter_attempt_mean`: mean of `inter_attempt_ms`
  - `inter_attempt_std`: standard deviation (low std = mechanical regularity)
  - `inter_attempt_min`, `inter_attempt_max`
  - `inter_attempt_cv`: coefficient of variation (std/mean) — humans are high CV, LLMs are low CV
  - `inter_attempt_median`
  - `attempt_rate`: attempts per second
  - `session_duration`: total session length in seconds

  **Exploration features:**
  - `unique_usernames`: count of distinct usernames tried
  - `unique_passwords`: count of distinct passwords tried
  - `credential_diversity`: unique passwords / total attempts (high = exploring, low = wordlist)
  - `username_entropy`: Shannon entropy of username distribution
  - `password_entropy`: Shannon entropy of password distribution
  - `success_ratio`: successful logins / total attempts

  **Command sequence features (post-auth sessions):**
  - `command_count`: total commands executed
  - `unique_commands`: distinct command count
  - `command_diversity`: unique / total
  - `recon_command_ratio`: fraction of commands that are recon (uname, whoami, cat /etc/passwd, ls, find)
  - `download_attempt`: binary — did session attempt wget/curl
  - `lateral_movement`: binary — did session attempt ssh/scp to other hosts
  - `command_inter_time_mean`: mean time between commands
  - `command_inter_time_std`: std dev of inter-command timing

  **Adaptation features:**
  - `password_pattern_change`: did the password strategy change after failures (e.g., switched from common passwords to service-specific ones)
  - `retry_after_block`: did the session reconnect after a failure
  - `strategy_shift_count`: number of times the approach changed (heuristic: password character class changed, or target port changed)

- [ ] Feature vector output: one row per session, all numeric, labeled HUMAN or AI_AGENT
- [ ] Save as Parquet: `ml/data/ai_detection_dataset.parquet`

- [ ] `notebooks/03_ai_agent_analysis.ipynb`:
  - Feature distribution comparison: HUMAN vs AI_AGENT side-by-side histograms for each feature
  - Focus on timing features — this is where the hypothesis predicts the clearest separation
  - Correlation matrix within each class
  - t-SNE or PCA visualization of the two classes in 2D
  - Document which features show clear separation and which don't

**Acceptance criteria:**
- Dataset contains ≥200 AI_AGENT sessions and ≥500 HUMAN sessions
- All behavioral features computed without NaN (handle missing with 0 or median)
- EDA notebook shows at least 3 features with visible class separation
- If no features show separation, document that honestly — the result is still scientifically valid

---

### Task 4: Sequence Model Training

**Requirements:**
- [ ] Add PyTorch to `ml/pyproject.toml` dependencies (torch, no CUDA requirement — CPU is sufficient for this dataset size)

- [ ] `ml/src/models/sequence_model.py`:
  - **Input representation:** Each session is a variable-length sequence of "events" (each auth attempt or command is one timestep). Each timestep has features: inter-time since previous event (ms), event type (auth_attempt=0, command=1, download=2), success (0/1), and optionally embedded categorical features.
  - **Pad/truncate** sequences to a fixed max length (e.g., 50 timesteps). Shorter sessions are zero-padded. Longer sessions are truncated to last 50 events.

  **Model A — 1D CNN:**
  ```python
  class AttackSequenceCNN(nn.Module):
      def __init__(self, input_dim, num_filters=64, kernel_sizes=[3, 5, 7]):
          # Multi-kernel 1D convolutions over the event sequence
          # Each kernel size captures patterns at different temporal scales
          # GlobalMaxPool → concat → FC → sigmoid (binary: HUMAN vs AI_AGENT)
  ```

  **Model B — LSTM:**
  ```python
  class AttackSequenceLSTM(nn.Module):
      def __init__(self, input_dim, hidden_dim=64, num_layers=2, dropout=0.3):
          # Bidirectional LSTM over event sequence
          # Take final hidden state → FC → sigmoid
  ```

  **Model C — Tabular baseline (for comparison):**
  - XGBoost on the per-session aggregate features from Task 3 (no sequence modeling)
  - This baseline answers: "does the temporal sequence add value over aggregate stats?"

- [ ] `ml/src/training/train_ai_detector.py`:
  - Loads dataset from `ai_detection_dataset.parquet`
  - For sequence models: loads raw session JSONs, converts to padded sequences
  - Stratified 80/20 train/test split
  - Trains all three models (CNN, LSTM, tabular baseline)
  - Binary classification: HUMAN=0, AI_AGENT=1
  - Loss: binary cross-entropy
  - Optimizer: Adam, lr=1e-3, with ReduceLROnPlateau scheduler
  - Early stopping on validation loss (patience 10 epochs)
  - Saves best model checkpoint: `ml/models/saved/ai_detector_cnn_v1.pt`, `ai_detector_lstm_v1.pt`, `ai_detector_xgb_v1.joblib`

**Acceptance criteria:**
- All three models train without errors
- Training logs show decreasing loss
- Models produce predictions in [0, 1] range
- Tabular baseline provides a comparison point for sequence models

---

### Task 5: Evaluation & Honest Documentation

**Requirements:**
- [ ] `ml/src/evaluation/evaluate_ai_detector.py`:
  - Binary classification metrics: precision, recall, F1, accuracy, ROC-AUC
  - Confusion matrix (2x2: HUMAN vs AI_AGENT)
  - ROC curve with AUC score
  - Precision-recall curve (important when classes are imbalanced)
  - Per-model comparison: CNN vs LSTM vs tabular baseline
  - Feature importance for the tabular baseline (which behavioral features matter most)
  - Save plots to `ml/evaluation/plots/ai_detection/`

- [ ] `docs/AI_DETECTION.md` — the most important document in this phase:

  **Methodology section:**
  - How HUMAN data was collected (honeypots, regions, timeframe, session count)
  - How AI_AGENT data was generated (lab setup, LLM model used, prompt strategy, session count)
  - Behavioral features extracted and rationale for each
  - Model architectures and training procedure

  **Results section:**
  - Per-model metrics table
  - Confusion matrices
  - Which features showed the strongest signal (with plots)
  - Whether sequence models outperformed the tabular baseline (and by how much)

  **Limitations section (this must be substantive, not boilerplate):**
  - The AI_AGENT class is defined by a specific LLM (Claude/GPT) with specific prompts. Different LLMs, different prompting strategies, or custom attack tools would produce different behavioral patterns. The model detects *this kind* of AI automation, not all possible AI automation.
  - The HUMAN class includes traditional bots (Mirai, credential stuffers), not just literal humans typing. The real distinction is "traditional automation" vs "LLM-guided automation."
  - The dataset is small (~200-500 AI_AGENT sessions). Deep learning models may overfit. The tabular baseline may perform comparably with less risk of overfitting.
  - The lab environment is synthetic — network conditions, latency, and load differ from real attacks traversing the internet.
  - LLM inference latency (the strongest hypothesized signal) may change as models get faster, as providers add caching, or as attackers run local models with different latency profiles.
  - The model has not been validated against real-world AI-driven attacks (none are available for ground truth).
  - This is a research exploration, not a production-grade detection system. It demonstrates the methodology, not a solved problem.

  **Future work section:**
  - Adversarial robustness: could an attacker add random delays to defeat timing-based detection?
  - Multi-LLM training: generate data from multiple LLMs to improve generalization
  - Real-world validation: use the model in monitoring mode and manually label flagged sessions
  - Continual learning: retrain as LLM capabilities and latency profiles evolve

**Acceptance criteria:**
- All three models evaluated with full metrics
- AI_DETECTION.md contains all sections listed above
- Limitations section has ≥7 substantive points
- If the model doesn't work well (e.g., AUC < 0.7), the document says so honestly and analyzes why

---

### Task 6: Integration into ML Service

**Requirements:**
- [ ] Update `ml/src/features/schema.py`:
  - Add `AI_DETECTION_FEATURES` — the behavioral feature list from Task 3
  - These are session-level features, not flow-level (different granularity than `INTERSECTION_FEATURES` / `EYE_FULL_FEATURES`)

- [ ] Update `ModelRegistry`:
  - Support a new model type: `ai_detector`
  - `load()` handles `.pt` (PyTorch) models in addition to `.joblib`
  - Active model config: `active_model.json` can specify both the flow classifier and the AI detector independently

- [ ] Update inference server (`server.py`):
  - **Flow classifier** (existing): receives `FeatureVector` → returns `Classification` (BENIGN, DOS, PROBE, etc.)
  - **AI detector** (new): operates at session level, not flow level. Two integration options:

  **Option A — Citadel-side aggregation (recommended):**
  - The Citadel aggregates per-source-IP session data over a time window
  - Periodically (or on session completion), the Citadel sends a REST request to a new ML endpoint: `POST /ml/ai-detect` with session-level behavioral features
  - The ML service runs the AI detector and returns `{ isAiAgent: boolean, confidence: float }`
  - The Citadel updates the event's category to AI_AGENT if confidence > threshold

  **Option B — Eye-side integration:**
  - Requires accumulating session-level features in The Eye (harder, crosses flow boundaries)
  - Less practical for Phase 6

  **Recommended: Option A.** Add a lightweight HTTP endpoint to the ML service alongside the Unix socket. The Citadel calls it when it has enough session data to classify.

- [ ] Add `POST /ml/ai-detect` endpoint to ML service:
  - Accepts JSON: `{ features: { inter_attempt_mean: float, ... } }`
  - Loads the active AI detector model
  - Returns: `{ isAiAgent: boolean, confidence: float, model: string }`

- [ ] Update Citadel — `AiDetectionService.java`:
  - Monitors incoming events per source IP
  - After N events from the same IP (configurable, default 10), extracts session-level behavioral features from the accumulated events
  - Calls `POST /ml/ai-detect` with the features
  - If `isAiAgent` with confidence > 0.8: creates a new security event with category=AI_AGENT and publishes it
  - If confidence 0.5-0.8: logs as suspicious but does not create an event (OBSERVE equivalent)

**Acceptance criteria:**
- ML service loads and serves the AI detector model via HTTP endpoint
- Citadel aggregates session data and calls the detector
- AI_AGENT events appear in the event feed when the detector fires
- Existing flow-level classification continues to work unchanged

---

### Task 7: Dashboard Integration

**Requirements:**
- [ ] Update The Lens `ModelMetrics.tsx`:
  - New section: "AI Agent Detection" with:
    - Total AI_AGENT events detected
    - Confidence distribution of AI_AGENT classifications
    - Recent AI_AGENT events list

- [ ] Update `AttackFeed.tsx`:
  - AI_AGENT events highlighted with distinct color/icon (robot icon from lucide-react)
  - Category filter includes AI_AGENT

- [ ] The AI_AGENT playbook (already seeded in Phase 2: BLOCK + CRITICAL_ALERT, TTL 24h) triggers normally through the existing response pipeline — no dashboard changes needed for the response side

**Acceptance criteria:**
- AI_AGENT events appear in the attack feed with distinct styling
- ModelMetrics shows AI detection stats
- Filtering by AI_AGENT category works

---

### Task 8: Tests & CI

**Requirements:**
- [ ] `ml/tests/test_behavioral_features.py`:
  - Unit test: feature extraction on a synthetic session produces correct feature values
  - Unit test: all features are numeric, no NaN
  - Unit test: timing features from a regular-interval session produce low CV

- [ ] `ml/tests/test_ai_detector.py`:
  - Unit test: CNN model forward pass on a padded sequence produces a scalar in [0, 1]
  - Unit test: LSTM model forward pass produces a scalar in [0, 1]
  - Unit test: model save/load round-trip
  - Unit test: HTTP endpoint returns valid JSON response

- [ ] Update `ci-ml.yml`:
  - Tests run without PyTorch GPU (CPU only)
  - Tests use tiny synthetic data (not the full dataset)
  - Lab attack scripts are NOT run in CI (they require LLM API access)

**Acceptance criteria:**
- `pytest ml/tests/test_behavioral_features.py ml/tests/test_ai_detector.py` passes
- CI passes without GPU or LLM API access
- No test depends on the full dataset

---

## Scoped Out

| Item | Phase |
|---|---|
| Shadow scoring / model swap / rollback for AI detector | Stretch |
| Multi-LLM training data (GPT, Gemini, local models) | Future research |
| Adversarial robustness testing (attackers adding delays) | Future research |
| Real-world validation against confirmed AI attacks | Requires ground truth that doesn't exist |
| Online/continual learning for the AI detector | Stretch |
| Drift detection for AI behavioral patterns | Stretch |

---

## Architecture Reference

```
┌──────────────────────────────────────────────────────┐
│                 LAB ENVIRONMENT                       │
│                 (Docker Compose)                      │
│                                                       │
│  ┌─────────────┐        ┌──────────────────────┐     │
│  │ lab-honeypot │◄─ssh──│ lab-attacker          │     │
│  │ (Cowrie)     │       │ (Python + LLM API)    │     │
│  └──────┬──────┘        │ ssh_credential_guesser│     │
│         │ JSON logs      │ adaptive_explorer     │     │
│         ▼               └──────────────────────┘     │
│  session JSONs                                        │
│  labeled AI_AGENT                                     │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│              DATASET ASSEMBLY                         │
│                                                       │
│  HUMAN sessions ◄── honeypot normalized data          │
│  AI_AGENT sessions ◄── lab-generated data             │
│         │                                             │
│         ▼                                             │
│  behavioral_features.py → per-session feature vector  │
│         │                                             │
│         ▼                                             │
│  ai_detection_dataset.parquet                         │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│              MODEL TRAINING                           │
│                                                       │
│  train_ai_detector.py                                 │
│  ├── 1D CNN (temporal patterns)                       │
│  ├── LSTM (sequential dependencies)                   │
│  └── XGBoost baseline (aggregate features)            │
│         │                                             │
│         ▼                                             │
│  ai_detector_*.pt / .joblib                           │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│         ML SERVICE (Python)                           │
│                                                       │
│  Unix socket (flow classifier) ← unchanged            │
│  HTTP POST /ml/ai-detect (session classifier) ← new  │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│         THE CITADEL                                   │
│                                                       │
│  AiDetectionService                                   │
│  ├── Accumulates events per source IP                 │
│  ├── After N events: extract behavioral features      │
│  ├── POST /ml/ai-detect                              │
│  └── If AI_AGENT: create event + publish              │
└──────────────────────────────────────────────────────┘
```

---

## Verification Checklist

When Phase 6 is complete, all of the following must be true:

- [ ] Lab environment runs via Docker Compose (honeypot + attacker containers)
- [ ] LLM-driven attack scripts generate AI_AGENT session data with real inference timing
- [ ] ≥200 AI_AGENT sessions and ≥500 HUMAN sessions in the dataset
- [ ] Behavioral features extracted per session (timing, exploration, command sequence, adaptation)
- [ ] EDA notebook shows feature distributions with analysis of class separation
- [ ] Three models trained: 1D CNN, LSTM, XGBoost tabular baseline
- [ ] Full evaluation: precision, recall, F1, ROC-AUC, confusion matrix for all models
- [ ] AI_DETECTION.md complete with methodology, results, and ≥7 substantive limitations
- [ ] If model doesn't work well, document says so honestly
- [ ] ML service serves AI detector via HTTP endpoint
- [ ] Citadel aggregates session data and calls the detector
- [ ] AI_AGENT events appear in The Lens dashboard
- [ ] Attack scripts are documented as defensive research only
- [ ] Tests pass in CI without GPU or LLM API access
- [ ] Existing flow-level classification pipeline unchanged
