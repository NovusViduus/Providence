"""Generate poster-ready plots from Providence data.

Usage:
    cd ~/Downloads/Providence-main
    python3 scripts/poster_plots.py
"""

import re
import os
from pathlib import Path
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

OUT = Path("poster_plots")
OUT.mkdir(exist_ok=True)

# Light theme for white paper poster
plt.rcParams.update({
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "axes.edgecolor": "#333333",
    "axes.labelcolor": "#111111",
    "text.color": "#111111",
    "xtick.color": "#333333",
    "ytick.color": "#333333",
    "grid.color": "#dddddd",
    "font.size": 12,
    "font.family": "sans-serif",
})

COLORS = {
    "BENIGN": "#2da44e",
    "DOS": "#cf222e",
    "PROBE": "#bf8700",
    "BRUTE_FORCE": "#d4388c",
    "INJECTION": "#8250df",
    "EXFILTRATION": "#0969da",
}

MODEL_COLORS = {
    "Random Forest": "#cf222e",
    "XGBoost": "#bf8700",
    "LightGBM": "#2da44e",
}


# ── Plot 1: CICIDS Class Distribution ─────────────────────────────────────────

def plot_cicids_distribution():
    labels = ["BENIGN", "DOS", "PROBE", "BRUTE_FORCE", "INJECTION", "EXFILTRATION"]
    counts = [2271320, 379737, 158804, 13832, 2191, 1992]
    colors = [COLORS[l] for l in labels]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5), gridspec_kw={"width_ratios": [1.3, 1]})

    # Bar chart (left)
    bars = ax1.barh(labels[::-1], [c for c in counts[::-1]],
                    color=[COLORS[l] for l in labels[::-1]], edgecolor="white")
    ax1.set_xlabel("Sample Count")
    ax1.set_title("CICIDS2017 Training Data Distribution", fontsize=14, fontweight="bold")
    ax1.set_xscale("log")
    for bar, count in zip(bars, counts[::-1]):
        ax1.text(bar.get_width() * 1.2, bar.get_y() + bar.get_height()/2,
                f"{count:,}", va="center", fontsize=10, color="#111111")

    # Pie chart (right) — only label categories >1%, use legend for small ones
    def make_autopct(counts):
        total = sum(counts)
        def autopct(pct):
            if pct > 2:
                return f"{pct:.1f}%"
            return ""
        return autopct

    wedges, texts, autotexts = ax2.pie(
        counts, colors=colors, autopct=make_autopct(counts),
        startangle=90, pctdistance=0.75,
        textprops={"fontsize": 11, "color": "#111111"})

    # Legend instead of inline labels (avoids overlap)
    legend_labels = [f"{l} ({c:,})" for l, c in zip(labels, counts)]
    ax2.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(1.0, 0.5),
               fontsize=9, frameon=False)
    ax2.set_title("Class Proportions", fontsize=14, fontweight="bold")

    plt.tight_layout()
    plt.savefig(OUT / "01_cicids_distribution.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 01_cicids_distribution.png")


# ── Plot 2: Model Comparison ──────────────────────────────────────────────────

def plot_model_comparison():
    models = ["Random Forest", "XGBoost", "LightGBM"]
    accuracy = [0.9293, 0.9299, 0.9831]
    macro_f1 = [0.5647, 0.5615, 0.7207]
    sizes_mb = [102, 2.4, 0.602]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    x = np.arange(len(models))
    w = 0.3

    bars1 = ax1.bar(x - w/2, accuracy, w, label="Accuracy", color="#0969da", edgecolor="white")
    bars2 = ax1.bar(x + w/2, macro_f1, w, label="Macro F1", color="#d4388c", edgecolor="white")
    ax1.set_xticks(x)
    ax1.set_xticklabels(models)
    ax1.set_ylim(0, 1.15)
    ax1.set_ylabel("Score")
    ax1.set_title("Model Performance Comparison", fontsize=14, fontweight="bold")
    ax1.legend(loc="lower right", framealpha=0.9)
    ax1.grid(axis="y", alpha=0.3)

    for bar in bars1:
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                f"{bar.get_height():.3f}", ha="center", fontsize=9, color="#111111")
    for bar in bars2:
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                f"{bar.get_height():.3f}", ha="center", fontsize=9, color="#111111")

    # Model size comparison (log scale)
    bar_colors = [MODEL_COLORS[m] for m in models]
    bars3 = ax2.bar(models, sizes_mb, color=bar_colors, edgecolor="white")
    ax2.set_ylabel("Model Size (MB)")
    ax2.set_yscale("log")
    ax2.set_title("Model Size (log scale)", fontsize=14, fontweight="bold")
    ax2.grid(axis="y", alpha=0.3)
    for bar, size in zip(bars3, sizes_mb):
        label = f"{size:.1f} MB" if size >= 1 else f"{size*1024:.0f} KB"
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() * 1.5,
                label, ha="center", fontsize=11, color="#111111", fontweight="bold")

    plt.tight_layout()
    plt.savefig(OUT / "02_model_comparison.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 02_model_comparison.png")


# ── Plot 3: Honeypot Session Distribution ─────────────────────────────────────

def plot_honeypot_distribution():
    labels = ["BRUTE_FORCE", "PROBE", "EXFILTRATION"]
    counts = [183933, 92726, 6204]
    colors = [COLORS[l] for l in labels]

    fig, ax = plt.subplots(figsize=(8, 5))
    bars = ax.bar(labels, counts, color=colors, edgecolor="white", width=0.6)
    ax.set_ylabel("Session Count")
    ax.set_title("Honeypot Data: 282,863 Sessions Across 3 Regions\n(Feb 18 – Apr 15, 2026)",
                 fontsize=14, fontweight="bold")
    ax.grid(axis="y", alpha=0.3)

    for bar, count in zip(bars, counts):
        pct = count / sum(counts) * 100
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 3000,
                f"{count:,}\n({pct:.1f}%)", ha="center", fontsize=11, color="#111111")

    plt.tight_layout()
    plt.savefig(OUT / "03_honeypot_distribution.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 03_honeypot_distribution.png")


# ── Plot 4: Live Classification Results (from Eye logs) ──────────────────────

def plot_live_classification():
    log_dir = Path("data/eye-captures")
    regions = {"lure-us": "US (Virginia)", "lure-eu": "EU (Ireland)", "lure-ap": "AP (Singapore)"}
    region_data = {}

    for prefix, label in regions.items():
        log_file = log_dir / f"{prefix}_eye.log"
        if not log_file.exists():
            continue
        cats = Counter()
        with open(log_file) as f:
            for line in f:
                if "[CLASSIFY]" in line and "169.254.169.254" not in line:
                    m = re.search(r"→ (\w+)", line)
                    if m:
                        cats[m.group(1)] += 1
        region_data[label] = cats

    if not region_data:
        print("  ⚠ No eye logs found in data/eye-captures/, skipping live classification plot")
        return

    all_cats = sorted(set(c for cats in region_data.values() for c in cats))
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5), gridspec_kw={"width_ratios": [1.2, 1]})

    # Stacked bar by region
    x = np.arange(len(region_data))
    bottom = np.zeros(len(region_data))
    region_labels = list(region_data.keys())

    for cat in all_cats:
        vals = [region_data[r].get(cat, 0) for r in region_labels]
        color = COLORS.get(cat, "#888888")
        ax1.bar(x, vals, bottom=bottom, label=cat, color=color, edgecolor="white", width=0.5)
        bottom += vals

    ax1.set_xticks(x)
    ax1.set_xticklabels(region_labels)
    ax1.set_ylabel("Flow Count")
    ax1.set_title("Live Classification by Region\n(Overnight, Apr 15 2026)", fontsize=14, fontweight="bold")
    ax1.legend(loc="upper left", bbox_to_anchor=(0, -0.12), ncol=len(all_cats),
               frameon=False, fontsize=10)
    ax1.grid(axis="y", alpha=0.3)

    # Add total count on top of each bar
    for i, r in enumerate(region_labels):
        total = sum(region_data[r].values())
        ax1.text(i, total + 10, f"{total:,}", ha="center", fontsize=10, fontweight="bold")

    # Overall pie
    total = Counter()
    for cats in region_data.values():
        total.update(cats)
    labels = list(total.keys())
    sizes = list(total.values())
    colors_pie = [COLORS.get(l, "#888888") for l in labels]
    total_flows = sum(sizes)

    wedges, texts, autotexts = ax2.pie(
        sizes, colors=colors_pie,
        autopct=lambda p: f"{p:.1f}%" if p > 2 else "",
        startangle=90, pctdistance=0.75,
        textprops={"fontsize": 11, "color": "#111111"})

    legend_labels = [f"{l} ({c:,})" for l, c in zip(labels, sizes)]
    ax2.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(1.0, 0.5),
               fontsize=10, frameon=False)
    ax2.set_title(f"All Regions: {total_flows:,} Flows\n(excl. AWS metadata)",
                  fontsize=14, fontweight="bold")

    plt.tight_layout()
    plt.savefig(OUT / "04_live_classification.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 04_live_classification.png")


# ── Plot 5: Architecture Diagram ─────────────────────────────────────────────

def plot_architecture():
    fig, ax = plt.subplots(figsize=(16, 6))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 6.5)
    ax.axis("off")

    def draw_box(x, y, title, subtitle, color="#0969da"):
        box = dict(boxstyle="round,pad=0.5", facecolor=color, edgecolor=color, alpha=0.15)
        ax.text(x, y, title, fontsize=12, fontweight="bold", ha="center", va="center",
                color=color, bbox=box)
        ax.text(x, y + 0.7, subtitle, fontsize=9, ha="center", va="center",
                color="#444444", fontweight="normal")

    # Top row — main pipeline
    draw_box(2, 3.8, "The Eye\n(C++17)", "Packet Capture\n31 features/flow", "#cf222e")
    draw_box(6, 3.8, "ML Service\n(Python)", "LightGBM\nUnix Socket", "#8250df")
    draw_box(10, 3.8, "The Citadel\n(Java/Spring)", "REST + gRPC\nPostgreSQL + Redis", "#0969da")
    draw_box(14, 3.8, "The Lens\n(React/Three.js)", "3D Globe\nReal-time WS", "#2da44e")

    # Bottom row
    draw_box(2, 1.2, "Honeypots\n(Cowrie)", "3 Regions\n282K sessions", "#bf8700")
    draw_box(6, 1.2, "The Oracle\n(Python/boto3)", "VPC Flow Logs\nCloudTrail", "#bf8700")
    draw_box(10, 1.2, "The Ward\n(Chrome Ext)", "Phishing Detection\nThreat Scoring", "#d4388c")
    draw_box(14, 1.2, "Infrastructure", "Docker + Terraform\n7 CI Pipelines", "#444444")

    # Arrows (main pipeline)
    arrow = dict(arrowstyle="-|>", color="#333333", lw=2)
    for (x1, y1), (x2, y2) in [
        ((3.4, 3.8), (4.6, 3.8)),
        ((7.4, 3.8), (8.4, 3.8)),
        ((11.6, 3.8), (12.4, 3.8)),
    ]:
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=arrow)

    # Arrows (bottom to top)
    arrow_up = dict(arrowstyle="-|>", color="#888888", lw=1.5, linestyle="--")
    for (x1, y1), (x2, y2) in [
        ((2, 2.1), (2, 3.0)),
        ((6.8, 1.9), (9.2, 3.0)),
        ((10, 2.1), (10, 3.0)),
    ]:
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=arrow_up)

    ax.set_title("Providence System Architecture", fontsize=20, fontweight="bold",
                 color="#111111", pad=10)

    plt.savefig(OUT / "05_architecture.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 05_architecture.png")


# ── Plot 6: Response Tier Diagram ─────────────────────────────────────────────

def plot_response_tiers():
    fig, ax = plt.subplots(figsize=(14, 4))
    ax.set_xlim(0, 14)
    ax.set_ylim(0, 4)
    ax.axis("off")

    tiers = [
        (2.5, 2.2, "OBSERVE", "Confidence < 0.6", "#2da44e",
         "Log event\nDashboard visibility only"),
        (7, 2.2, "RECOMMEND", "Confidence 0.6 – 0.85", "#bf8700",
         "Generate incident report\nHuman approval required"),
        (11.5, 2.2, "ACT", "Confidence > 0.85", "#cf222e",
         "Auto-block via firewall\nPlaybook execution"),
    ]

    for x, y, name, conf, color, desc in tiers:
        box = dict(boxstyle="round,pad=0.6", facecolor=color, edgecolor=color, alpha=0.12)
        ax.text(x, y, f"{name}\n{conf}", fontsize=14, fontweight="bold",
                ha="center", va="center", color=color, bbox=box)
        ax.text(x, y - 1.2, desc, fontsize=10, ha="center", va="center", color="#444444")

    # Arrows between tiers
    arrow = dict(arrowstyle="-|>", color="#333333", lw=2.5)
    ax.annotate("", xy=(5.0, 2.2), xytext=(4.2, 2.2), arrowprops=arrow)
    ax.annotate("", xy=(9.5, 2.2), xytext=(8.7, 2.2), arrowprops=arrow)

    ax.set_title("Tiered Response Engine", fontsize=18, fontweight="bold", color="#111111")

    plt.savefig(OUT / "06_response_tiers.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 06_response_tiers.png")


# ── Plot 7: Confidence Distribution from Live Logs ───────────────────────────

def plot_confidence_distribution():
    log_dir = Path("data/eye-captures")
    confidences = {"BENIGN": [], "EXFILTRATION": [], "BRUTE_FORCE": []}

    for log_file in log_dir.glob("*_eye.log"):
        with open(log_file) as f:
            for line in f:
                if "[CLASSIFY]" in line and "169.254.169.254" not in line:
                    m = re.search(r"→ (\w+) \(([0-9.]+)\)", line)
                    if m:
                        cat, conf = m.group(1), float(m.group(2))
                        if cat in confidences:
                            confidences[cat].append(conf)

    if not any(confidences.values()):
        print("  ⚠ No confidence data found, skipping")
        return

    fig, ax = plt.subplots(figsize=(10, 5))
    bins = np.linspace(0, 1, 40)

    for cat, confs in confidences.items():
        if confs:
            ax.hist(confs, bins=bins, alpha=0.65, label=f"{cat} (n={len(confs)})",
                    color=COLORS.get(cat, "#888888"), edgecolor="white")

    ax.set_xlabel("Classification Confidence")
    ax.set_ylabel("Flow Count")
    ax.set_title("Confidence Score Distribution (Live Traffic)", fontsize=14, fontweight="bold")
    ax.legend(framealpha=0.9)
    ax.grid(axis="y", alpha=0.3)

    plt.tight_layout()
    plt.savefig(OUT / "07_confidence_distribution.png", dpi=200, bbox_inches="tight")
    plt.close()
    print("  ✓ 07_confidence_distribution.png")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Generating poster plots...")
    plot_cicids_distribution()
    plot_model_comparison()
    plot_honeypot_distribution()
    plot_live_classification()
    plot_architecture()
    plot_response_tiers()
    plot_confidence_distribution()
    print(f"\nAll plots saved to {OUT}/")
