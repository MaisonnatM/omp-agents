#!/usr/bin/env python3
"""Run a heavy command, such as a build, a test suite, or a browser run, once one of the machine's heavy slots is free.

Usage: heavy.py COMMAND [ARG ...]
       heavy.py 'SHELL COMMAND'    one argument runs through /bin/sh -c, for && and pipes

Every omp session on this computer shares the slots, so at most OMP_HEAVY_SLOTS heavy commands run at once,
by default a quarter of the CPU cores and at least 1. A slot is an flock on a file in OMP_HEAVY_DIR, by default
/tmp/omp-heavy-<uid>; the kernel releases it when this process ends, however it ends, so no slot goes stale.
A waiter says once on stderr that it is queued and what holds the slots, and again when it gets one.
A heavy command run inside another, which finds OMP_HEAVY_SLOT set, runs at once in its parent's slot.
Exits with the command's status, 128 plus the signal's number when a signal ended it.
"""

from __future__ import annotations

import fcntl
import os
import shlex
import signal
import subprocess
import sys
import time

POLL_SECONDS = 0.5


def slot_count() -> int:
    raw = os.environ.get("OMP_HEAVY_SLOTS", "").strip()
    if not raw:
        return max(1, (os.cpu_count() or 1) // 4)
    if not raw.isdigit() or int(raw) < 1:
        sys.exit(f"heavy: OMP_HEAVY_SLOTS must be a whole number of at least 1, not {raw!r}")
    return int(raw)


def holders(directory: str, slots: int) -> str:
    lines = []
    for index in range(slots):
        try:
            with open(os.path.join(directory, f"slot-{index}")) as file:
                holder = file.read().strip()
        except OSError:
            holder = ""
        lines.append(f"  slot {index + 1}: {holder or 'busy'}")
    return "\n".join(lines)


def acquire(directory: str, slots: int, label: str) -> tuple[int, int]:
    """Locks the first free slot, polling until one is; returns its index and the descriptor that holds it."""
    os.makedirs(directory, exist_ok=True)
    # os.open descriptors are not inherited by the command, so only this process holds the slot.
    fds = [os.open(os.path.join(directory, f"slot-{index}"), os.O_RDWR | os.O_CREAT, 0o644) for index in range(slots)]
    queued_at = None
    while True:
        for index, fd in enumerate(fds):
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            for other in fds:
                if other != fd:
                    os.close(other)
            os.ftruncate(fd, 0)
            os.pwrite(fd, f"pid {os.getpid()}: {label}\n".encode(), 0)
            if queued_at is not None:
                waited = round(time.monotonic() - queued_at)
                print(f"heavy: got slot {index + 1} after {waited}s, running {label}", file=sys.stderr, flush=True)
            return index, fd
        if queued_at is None:
            queued_at = time.monotonic()
            print(
                f"heavy: queued, all {slots} heavy slots are busy; {label} starts when one frees:\n{holders(directory, slots)}",
                file=sys.stderr,
                flush=True,
            )
        time.sleep(POLL_SECONDS)


def run(command: list[str], env: dict[str, str]) -> int:
    try:
        child = subprocess.Popen(command, env=env)
    except FileNotFoundError:
        print(f"heavy: command not found: {command[0]}", file=sys.stderr)
        return 127
    except PermissionError:
        print(f"heavy: permission denied: {command[0]}", file=sys.stderr)
        return 126
    # Ctrl-C already reaches the command through the terminal's process group; a kill aimed at this process alone is passed on.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    for forwarded in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(forwarded, lambda number, _frame: child.send_signal(number))
    status = child.wait()
    return 128 - status if status < 0 else status


def main(args: list[str]) -> int:
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip(), file=sys.stderr)
        return 0 if args else 2
    command = ["/bin/sh", "-c", args[0]] if len(args) == 1 else args
    if os.environ.get("OMP_HEAVY_SLOT"):
        return run(command, dict(os.environ))
    directory = os.environ.get("OMP_HEAVY_DIR") or f"/tmp/omp-heavy-{os.getuid()}"
    label = args[0] if len(args) == 1 else shlex.join(args)
    try:
        index, _fd = acquire(directory, slot_count(), label)
    except KeyboardInterrupt:
        return 130
    return run(command, {**os.environ, "OMP_HEAVY_SLOT": str(index + 1)})


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
