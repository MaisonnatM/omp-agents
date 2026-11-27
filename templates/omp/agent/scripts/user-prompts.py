#!/usr/bin/env python3
"""Print the prompts the user typed in omp sessions over the last hours.

Each prompt follows a header with its time and session title, and the end of
the agent reply it answered, so a correction ("I mean X") reads in context.
Subagent assignments and injected skill or system text are left out.

usage: user-prompts.py [--hours 24]
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

AGENT_DIR = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".omp" / "agent"))
SKIP_PREFIXES = ("Complete assignment", "[Wait interrupted", "Untrusted file", "UNATTENDED", "[omp-agents]")
INJECTED = re.compile(r"<(system-[a-z-]+|board-task)[^>]*>.*?</\1>", re.S)
THREAD = re.compile(r"<board-thread>(.*?)</board-thread>", re.S)
BOARD_REPLY = re.compile(r"The user replied on Board task[^\n]*\n\n(.*?)\n\nWhen it only asks", re.S)
REPLY_TAIL = 300
PROMPT_MAX = 1500


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    return " ".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")


def prompt_text(raw: str) -> str:
    if "[IMPORTANT: User invoked" in raw and "\nUser:" in raw:
        raw = raw.split("\nUser:", 1)[1]
    thread = THREAD.search(raw) or BOARD_REPLY.search(raw)
    if thread:
        raw = thread.group(1)
    return INJECTED.sub("", raw).strip()


def session_prompts(path: Path, since: datetime):
    title = path.stem
    last_reply = ""
    cwd = ""
    with path.open(errors="ignore") as lines:
        for line in lines:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") in ("title", "session") and entry.get("title"):
                title = entry["title"]
            if entry.get("type") == "session" and entry.get("cwd"):
                cwd = entry["cwd"].replace(str(Path.home()), "~")
            if entry.get("customType") == "skill-prompt":
                message = {"role": "user", "content": entry.get("content", "")}
            else:
                message = entry.get("message") or {}
            role = message.get("role")
            if role == "assistant":
                reply = text_of(message.get("content", "")).strip()
                if reply:
                    last_reply = reply
                continue
            if role != "user":
                continue
            at = datetime.fromisoformat(entry.get("timestamp", "1970-01-01T00:00:00Z").replace("Z", "+00:00"))
            text = prompt_text(text_of(message.get("content", "")))
            if at >= since and len(text) > 3 and not text.startswith(SKIP_PREFIXES) and "<irc" not in text:
                yield at, f"{title} · {cwd}", last_reply[-REPLY_TAIL:], text[:PROMPT_MAX]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=24)
    args = parser.parse_args()
    since = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    cutoff = since.timestamp()
    prompts = []
    seen = set()
    for path in (AGENT_DIR / "sessions").rglob("*.jsonl"):
        if path.stat().st_mtime < cutoff:
            continue
        for at, title, reply, text in session_prompts(path, since):
            if text not in seen:
                seen.add(text)
                prompts.append((at, title, reply, text))
    for at, title, reply, text in sorted(prompts):
        print(f"=== {at.astimezone():%Y-%m-%d %H:%M} · {title}")
        if reply:
            print("agent: …" + " ".join(reply.split()))
        print(f"user: {text}\n")
    print(f"{len(prompts)} prompts in the last {args.hours:g} hours", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
