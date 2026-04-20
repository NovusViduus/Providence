# Providence — Resume Bullet Points

- Built a multi-component network security platform (C++, Java, Python, TypeScript) with real-time intrusion detection, ML classification (F1 > 0.95 on CICIDS2017), and automated response across local, cloud, and browser attack surfaces

- Implemented a C++ packet capture engine processing 100K+ packets/sec with a lock-free SPSC ring buffer, IHL-aware TCP parsing, TLS/JA3 fingerprinting, Shannon entropy analysis, and 31 features per flow

- Trained attack classifiers (Random Forest, XGBoost, LightGBM) on CICIDS2017 + live honeypot data with a documented two-model strategy (intersection features vs full Eye features) that avoids train/serve skew

- Designed a tiered autonomous response engine (Observe → Recommend → Act) with TTL-based auto-expiry, cross-platform firewall abstraction (pfctl/iptables/AWS NACL), playbook matching, and a full audit trail

- Built an experimental AI-agent detection module using LSTM and 1D CNN sequence models on LLM-generated synthetic attack data, with 24 behavioral features and 9 documented limitations

- Deployed AWS cloud monitoring (VPC Flow Logs, CloudTrail) with rule-based classification for IAM escalation, resource abuse, and data exposure, plus Lambda remediation functions and Terraform IaC

- Created a React/Three.js real-time dashboard with a 3D threat visualization globe (InstancedMesh markers, TopoJSON boundaries, Raycaster tooltips), WebSocket live feed, JWT RBAC, and manual override panel

- Published a Chrome Manifest V3 extension for web-layer threat detection (phishing via Levenshtein distance, cryptominer hosts, DOM analysis) with standalone and connected modes
