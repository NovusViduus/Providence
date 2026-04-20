"""Feature schema definitions for Providence ML pipeline.

Two feature sets:
- INTERSECTION_FEATURES: Features with clean semantic equivalence between CICIDS and The Eye.
  Used for the CICIDS baseline model. No approximate mappings.
- EYE_FULL_FEATURES: Complete Eye feature set including entropy, JA3, window stats,
  inter-arrival timing. Used for the Eye-native model trained on Eye-processed data.
"""

import numpy as np
import pandas as pd

# Features with clean, unambiguous mappings between CICIDS columns and Eye FlowStats fields.
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

# Complete Eye feature set — superset of INTERSECTION_FEATURES.
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
# Note: ja3_hash is a string field — handled separately as categorical or dropped.


# CICIDS column name → Providence feature name mapping (intersection only)
CICIDS_COLUMN_MAP = {
    "Flow Duration": "flow_duration",
    "Total Fwd Packets": "packet_count_fwd",
    "Total Backward Packets": "packet_count_bwd",
    "Total Length of Fwd Packets": "bytes_fwd",
    "Total Length of Bwd Packets": "bytes_bwd",
    "Flow Bytes/s": "bytes_per_sec",
    "Flow Packets/s": "packets_per_sec",
    "SYN Flag Count": "syn_count",
    "ACK Flag Count": "ack_count",
    "FIN Flag Count": "fin_count",
    "RST Flag Count": "rst_count",
    "Fwd PSH Flags": "psh_count",
    "URG Flag Count": "urg_count",
    "Average Packet Size": "payload_size_mean",
}

# Providence label taxonomy
VALID_CATEGORIES = ["BENIGN", "DOS", "PROBE", "BRUTE_FORCE", "INJECTION", "EXFILTRATION"]

# CICIDS label → Providence category mapping
CICIDS_LABEL_MAP = {
    "BENIGN": "BENIGN",
    "DoS Hulk": "DOS",
    "DoS GoldenEye": "DOS",
    "DoS Slowhttptest": "DOS",
    "DoS slowloris": "DOS",
    "DDoS": "DOS",
    "PortScan": "PROBE",
    "FTP-Patator": "BRUTE_FORCE",
    "SSH-Patator": "BRUTE_FORCE",
    "Web Attack \x96 Brute Force": "INJECTION",
    "Web Attack \x96 XSS": "INJECTION",
    "Web Attack \x96 Sql Injection": "INJECTION",
    "Web Attack – Brute Force": "INJECTION",
    "Web Attack – XSS": "INJECTION",
    "Web Attack – Sql Injection": "INJECTION",
    "Web Attack \ufffd Brute Force": "INJECTION",
    "Web Attack \ufffd XSS": "INJECTION",
    "Web Attack \ufffd Sql Injection": "INJECTION",
    "Infiltration": "EXFILTRATION",
    "Bot": "EXFILTRATION",
    "Heartbleed": "INJECTION",
}


def cicids_row_to_array(row: pd.Series) -> np.ndarray:
    """Convert a CICIDS DataFrame row to a numpy array using INTERSECTION_FEATURES ordering."""
    values = []
    for feat in INTERSECTION_FEATURES:
        if feat == "packet_count":
            values.append(row.get("Total Fwd Packets", 0) + row.get("Total Backward Packets", 0))
        elif feat == "total_bytes":
            values.append(row.get("Total Length of Fwd Packets", 0) + row.get("Total Length of Bwd Packets", 0))
        else:
            cicids_col = next((k for k, v in CICIDS_COLUMN_MAP.items() if v == feat), None)
            values.append(row.get(cicids_col, 0) if cicids_col else 0)
    return np.array(values, dtype=np.float64)


def protobuf_to_array(fv, feature_set: list[str]) -> np.ndarray:
    """Convert a protobuf FeatureVector to a numpy array for the given feature set.

    Args:
        fv: A features_pb2.FeatureVector protobuf message.
        feature_set: Either INTERSECTION_FEATURES or EYE_FULL_FEATURES.

    Returns:
        numpy array with values in feature_set order.
    """
    field_map = {
        "flow_duration": lambda: fv.duration,
        "packet_count_fwd": lambda: fv.packet_count_fwd,
        "packet_count_bwd": lambda: fv.packet_count_bwd,
        "bytes_fwd": lambda: fv.bytes_fwd,
        "bytes_bwd": lambda: fv.bytes_bwd,
        "packets_per_sec": lambda: fv.packets_per_sec,
        "bytes_per_sec": lambda: fv.bytes_per_sec,
        "syn_count": lambda: fv.syn_count,
        "ack_count": lambda: fv.ack_count,
        "fin_count": lambda: fv.fin_count,
        "rst_count": lambda: fv.rst_count,
        "psh_count": lambda: fv.psh_count,
        "urg_count": lambda: fv.urg_count,
        "payload_size_mean": lambda: fv.payload_size_mean,
        "packet_count": lambda: fv.packet_count,
        "total_bytes": lambda: fv.total_bytes,
        "window_size_min": lambda: fv.window_size_min,
        "window_size_max": lambda: fv.window_size_max,
        "window_size_mean": lambda: fv.window_size_mean,
        "payload_entropy_mean": lambda: fv.payload_entropy_mean,
        "payload_size_min": lambda: fv.payload_size_min,
        "payload_size_max": lambda: fv.payload_size_max,
        "zero_payload_count": lambda: fv.zero_payload_count,
        "ttl": lambda: fv.ttl,
        "cipher_suite_count": lambda: fv.cipher_suite_count,
        "extension_count": lambda: fv.extension_count,
        "inter_arrival_mean": lambda: fv.inter_arrival_mean,
        "inter_arrival_std": lambda: fv.inter_arrival_std,
        "inter_arrival_min": lambda: fv.inter_arrival_min,
        "inter_arrival_max": lambda: fv.inter_arrival_max,
        "syn_ack_ratio": lambda: (fv.syn_count / fv.ack_count) if fv.ack_count > 0 else 0.0,
    }
    return np.array([field_map[f]() for f in feature_set], dtype=np.float64)


def validate_dataframe(df: pd.DataFrame, feature_set: list[str]) -> None:
    """Assert that a DataFrame's columns match the given feature set."""
    missing = set(feature_set) - set(df.columns)
    extra = set(df.columns) - set(feature_set)
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    if extra:
        raise ValueError(f"Extra columns: {extra}")
