"""
FOR DEFENSIVE RESEARCH ONLY — generates synthetic AI_AGENT post-auth
exploration sessions for training attack detection models.

LLM decides what commands to run based on previous output,
capturing context-aware command sequences with real inference timing.
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

INITIAL_COMMANDS = ["uname -a", "whoami", "id"]


def get_next_command(previous_output: str, commands_so_far: list[str]) -> str:
    """Ask LLM what command to run next based on previous output."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        time.sleep(2.0 + len(commands_so_far) * 0.3)
        fallback = [
            "cat /etc/passwd", "ls -la /home", "find / -name '*.pem' 2>/dev/null",
            "cat /etc/shadow", "netstat -tlnp", "ps aux", "df -h",
            "cat /etc/hosts", "env", "history",
        ]
        idx = len(commands_so_far) % len(fallback)
        return fallback[idx]

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=LLM_MODEL,
            max_tokens=100,
            messages=[{"role": "user", "content": (
                "You've gained SSH access to a Linux server. Your goal is to assess what's valuable. "
                f"Commands run so far: {commands_so_far}. "
                f"Output of last command: {previous_output[:500]}. "
                "What single command do you run next? Return ONLY the command, nothing else."
            )}],
        )
        return msg.content[0].text.strip()
    except Exception:
        time.sleep(2.5)
        return "ls -la"


def run_exploration_session(session_num: int, max_commands: int = 15) -> dict:
    """Run one AI-driven post-auth exploration session."""
    session_id = f"lab-ai-explore-{session_num:04d}"
    commands = []
    inter_times = []
    start = time.time()
    prev_time = start

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HONEYPOT_HOST, port=HONEYPOT_PORT,
                       username="root", password="root", timeout=5,
                       allow_agent=False, look_for_keys=False)
    except Exception as e:
        print(f"  Failed to connect: {e}")
        return {"session_id": session_id, "error": str(e)}

    last_output = ""
    for i in range(max_commands):
        if i < len(INITIAL_COMMANDS):
            cmd = INITIAL_COMMANDS[i]
        else:
            cmd = get_next_command(last_output, [c for c, _ in commands])

        now = time.time()
        inter_times.append(int((now - prev_time) * 1000))
        prev_time = now

        try:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=5)
            last_output = stdout.read().decode("utf-8", errors="replace")[:1000]
            commands.append((cmd, last_output[:200]))
        except Exception:
            commands.append((cmd, ""))
            break

    client.close()
    duration = time.time() - start

    return {
        "session_id": session_id,
        "source": "lab-attacker",
        "src_ip": "172.20.0.3",
        "dst_port": HONEYPOT_PORT,
        "protocol": "tcp",
        "category": "AI_AGENT",
        "session_metadata": {
            "duration_seconds": round(duration, 2),
            "attempts_in_session": len(commands),
            "commands_executed": [c for c, _ in commands],
            "inter_attempt_ms": inter_times[1:] if len(inter_times) > 1 else [],
            "llm_model": LLM_MODEL,
            "generation_timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", type=int, default=100)
    parser.add_argument("--target", default=HONEYPOT_HOST)
    args = parser.parse_args()

    global HONEYPOT_HOST
    HONEYPOT_HOST = args.target
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Generating {args.sessions} AI_AGENT exploration sessions")
    for i in range(args.sessions):
        print(f"Session {i+1}/{args.sessions}...")
        session = run_exploration_session(i)
        path = SESSIONS_DIR / f"{session['session_id']}.json"
        with open(path, "w") as f:
            json.dump(session, f, indent=2)

    print(f"Done. Sessions saved to {SESSIONS_DIR}/")


if __name__ == "__main__":
    main()
