#!/usr/bin/env python3
"""Compare omp session speed before and after a config cutover.

Usage: session-speed.py [CUTOVER_ISO] [DAYS_BEFORE]
Defaults: the 2026-10-12 auto-effort cutover, 14 days of baseline.
Counts only time the agent worked on a prompt: model streaming plus tool waits, not time waiting on the user.
"""
import collections, datetime, glob, json, os, statistics, sys

CUT = datetime.datetime.fromisoformat(sys.argv[1] if len(sys.argv) > 1 else "2026-10-12T07:46:30+00:00")
DAYS = int(sys.argv[2]) if len(sys.argv) > 2 else 14
ROOT = os.path.expanduser("~/.omp/agent/sessions")
cut_ms = CUT.timestamp() * 1000
lo_ms = cut_ms - DAYS * 86400_000


def messages(path):
    for line in open(path):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("type") == "message":
            yield o["message"]


def prompts(path):
    """Yield one record per prompt: model seconds, tool seconds, turns, output tokens, efforts.

    A session's opening prompt is not stored as a user message, so its turns open the first record.
    """
    cur = None
    last_end = None
    batch_max = 0.0
    for m in messages(path):
        role = m["role"]
        if role == "user" or cur is None:
            if cur:
                yield cur
            cur = {"model": 0.0, "tool": 0.0, "turns": 0, "out": 0, "effort": collections.Counter(), "tools": collections.Counter()}
            last_end = None
            if role == "user":
                continue
        if role == "assistant" and m.get("completedAt"):
            cur["model"] += (m["completedAt"] - m["timestamp"]) / 1000
            cur["turns"] += 1
            cur["out"] += m.get("usage", {}).get("output", 0)
            cur["effort"][(m.get("requestControls", {}).get("effort") or {}).get("topLevel")] += 1
            last_end = m["completedAt"]
            batch_max = 0.0
        elif role == "toolResult" and last_end:
            dt = (m["timestamp"] - last_end) / 1000
            if dt > batch_max:
                cur["tool"] += dt - batch_max
                cur["tools"][m.get("toolName")] += dt - batch_max
                batch_max = dt
    if cur:
        yield cur


def subagent_stats(files):
    walls = collections.defaultdict(list)
    for path in files:
        ts = [m["timestamp"] for m in messages(path) if m.get("timestamp")]
        if ts and lo_ms <= ts[0]:
            walls["post" if ts[0] >= cut_ms else "pre"].append((ts[-1] - ts[0]) / 1000)
    return walls


def started_ms(path):
    """Sessions keep the effort they started with, so bucket by the start stamp in the file name."""
    stamp = os.path.basename(path).split("_")[0]
    day, clock = stamp.split("T")
    return datetime.datetime.fromisoformat(f"{day}T{clock[:8].replace('-', ':')}+00:00").timestamp() * 1000


top = [f for f in glob.glob(f"{ROOT}/*/*.jsonl") if "/--private-tmp" not in f and started_ms(f) >= lo_ms]
buckets = {"pre": [], "post": []}
for f in top:
    bucket = buckets["post" if started_ms(f) >= cut_ms else "pre"]
    bucket.extend(p for p in prompts(f) if p["turns"])


def thermo_files(sessions):
    """Subagent transcripts live under <session>/<task name>.jsonl; match names the parent spawned as thermonuclear-reviewer."""
    for path in sessions:
        for m in messages(path):
            for c in m.get("content", []) if m["role"] == "assistant" else []:
                if c.get("type") == "toolCall" and c.get("name") == "task":
                    for t in (c.get("arguments") or {}).get("tasks") or []:
                        if t.get("agent") == "thermonuclear-reviewer" and t.get("name"):
                            yield from glob.glob(f"{path[:-6]}/**/{t['name']}.jsonl", recursive=True)


thermo = subagent_stats(set(thermo_files(top)))


def pct(xs, q):
    return statistics.quantiles(xs, n=10)[q - 1] if len(xs) >= 10 else float("nan")


print(f"cutover {CUT.isoformat()}  baseline {DAYS}d")
print(f"{'':28}{'pre':>12}{'post':>12}")
rows = []
for name, ps in buckets.items():
    active = [(p["model"] + p["tool"]) / 60 for p in ps]
    turns = sum(p["turns"] for p in ps) or 1
    model = sum(p["model"] for p in ps)
    effort = sum((p["effort"] for p in ps), collections.Counter())
    waits = sum(p["tools"]["task"] + p["tools"]["wait"] for p in ps)
    total = sum(p["model"] + p["tool"] for p in ps) or 1
    rows.append({
        "prompts": len(ps),
        "active min/prompt p50": statistics.median(active) if active else float("nan"),
        "active min/prompt p90": pct(active, 9),
        "model s/turn": model / turns,
        "output tok/turn": sum(p["out"] for p in ps) / turns,
        "subagent wait share %": 100 * waits / total,
        "turns at low/med %": 100 * (effort["low"] + effort["medium"] + effort["minimal"]) / turns,
        "turns at xhigh/max %": 100 * (effort["xhigh"] + effort["max"]) / turns,
    })
for key in rows[0]:
    print(f"{key:28}{rows[0][key]:>12.1f}{rows[1][key]:>12.1f}")
print(f"{'sessions':28}{sum(started_ms(f) < cut_ms for f in top):>12}{sum(started_ms(f) >= cut_ms for f in top):>12}")
for name in ("pre", "post"):
    w = [s / 60 for s in thermo.get(name, [])]
    if w:
        print(f"thermonuclear {name}: {len(w)} runs, median {statistics.median(w):.1f} min, mean {statistics.mean(w):.1f} min")
