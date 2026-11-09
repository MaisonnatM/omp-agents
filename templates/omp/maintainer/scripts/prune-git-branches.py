#!/usr/bin/env python3
"""Prune worktrees and local branches whose upstream branch is gone.

Usage: prune-git-branches.py [--apply] [REPO ...]
Default is a dry run; REPO defaults to ~/code/yampa and ~/code/omp-agents.

Per repository:
  1. git fetch --prune (the repository is skipped if this fails).
  2. Removes a linked worktree only when its branch's upstream is gone, it has no
     changes or untracked non-ignored files, no merge/rebase/cherry-pick/revert/bisect
     in progress, it is not locked, and no process has its cwd inside it.
     The main checkout is never touched; `git worktree remove` runs without --force.
  3. Deletes a local branch whose upstream is gone and that no worktree has checked
     out (including a branch mid-rebase) only when its work is on the trunk:
     its tip is an ancestor of origin/<trunk>, `git cherry` finds every commit
     upstream, or GitHub has a merged PR from that branch whose head contains the
     local tip or the same patches. Such a branch goes through `git branch -D`.
     Everything else is kept and listed with the reason.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

DEFAULT_REPOS = [Path.home() / "code" / "yampa", Path.home() / "code" / "omp-agents"]
IN_PROGRESS_MARKERS = (
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
)


def run(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed ({result.returncode}): {result.stderr.strip()}")
    return result


def git(repo: Path, *args: str, check: bool = True) -> str:
    return run(["git", *args], repo, check).stdout


def process_cwds() -> list[str]:
    out = subprocess.run(["lsof", "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
    return [line[1:] for line in out.splitlines() if line.startswith("n/")]


def in_use(path: str, cwds: list[str]) -> bool:
    roots = {path, os.path.realpath(path)}
    return any(cwd == root or cwd.startswith(root + "/") for cwd in cwds for root in roots)


def list_worktrees(repo: Path) -> list[dict]:
    worktrees: list[dict] = []
    current: dict = {}
    for line in git(repo, "worktree", "list", "--porcelain").splitlines() + [""]:
        if not line:
            if current:
                worktrees.append(current)
            current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value if value else True
    for index, wt in enumerate(worktrees):
        wt["main"] = index == 0
        branch = wt.get("branch")
        wt["branch_name"] = branch.removeprefix("refs/heads/") if isinstance(branch, str) else None
    return worktrees


def git_path(worktree: str, name: str) -> Path:
    path = Path(git(Path(worktree), "rev-parse", "--git-path", name).strip())
    return path if path.is_absolute() else Path(worktree) / path


def rebasing_branch(worktree: str) -> str | None:
    for marker in ("rebase-merge", "rebase-apply"):
        head_name = git_path(worktree, marker) / "head-name"
        if head_name.is_file():
            return head_name.read_text().strip().removeprefix("refs/heads/")
    return None


def worktree_block_reason(wt: dict, cwds: list[str]) -> str | None:
    path = wt["worktree"]
    if wt.get("locked"):
        return "locked"
    if wt.get("prunable") or not Path(path).is_dir():
        return "directory missing (left to `git worktree prune`)"
    if in_use(path, cwds):
        return "a process has its cwd inside"
    status = run(["git", "status", "--porcelain", "--untracked-files=normal"], Path(path), check=False)
    if status.returncode != 0:
        return f"git status failed: {status.stderr.strip()}"
    if status.stdout.strip():
        return "uncommitted changes or untracked files"
    for marker in IN_PROGRESS_MARKERS:
        if git_path(path, marker).exists():
            return f"{marker} in progress"
    return None


def merged_locally(repo: Path, trunk: str, tip: str) -> str | None:
    if run(["git", "merge-base", "--is-ancestor", tip, trunk], repo, check=False).returncode == 0:
        return f"tip is in {trunk}"
    cherry = run(["git", "cherry", trunk, tip], repo, check=False)
    signs = [line[:1] for line in cherry.stdout.splitlines()]
    if cherry.returncode == 0 and signs and all(sign == "-" for sign in signs):
        return f"git cherry: all commits in {trunk}"
    return None


def merged_prs(repo: Path, head: str) -> list[dict] | str:
    """Merged PRs whose head branch is `head`, or the error message after retries."""
    args = ["gh", "pr", "list", "--head", head, "--state", "merged", "--json", "number,headRefOid", "--limit", "50"]
    for _ in range(3):
        result = run(args, repo, check=False)
        if result.returncode == 0:
            return json.loads(result.stdout or "[]")
    return f"gh pr list failed: {result.stderr.strip()[:200]}"


def contained_in_pr(repo: Path, tip: str, prs: list[dict]) -> str | None:
    """Evidence that every local commit is in a merged PR's head (same commits or same patches)."""
    for pr in prs:
        oid = pr["headRefOid"]
        if oid == tip:
            return f"PR #{pr['number']} merged"
        if run(["git", "cat-file", "-e", f"{oid}^{{commit}}"], repo, check=False).returncode != 0:
            continue
        if run(["git", "merge-base", "--is-ancestor", tip, oid], repo, check=False).returncode == 0:
            return f"PR #{pr['number']} merged"
        cherry = run(["git", "cherry", oid, tip], repo, check=False)
        signs = [line[:1] for line in cherry.stdout.splitlines()]
        if cherry.returncode == 0 and signs and all(sign == "-" for sign in signs):
            return f"PR #{pr['number']} merged (same patches)"
    return None


def fetch_pr_heads(repo: Path, numbers: list[int]) -> None:
    """Fetch merged PR heads whose commits are no longer reachable locally; no refs are written."""
    def fetch(refspecs: list[str]) -> bool:
        args = ["git", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "fetch", "--quiet", "--no-tags"]
        return run([*args, "--no-write-fetch-head", "origin", *refspecs], repo, check=False).returncode == 0

    refspecs = [f"refs/pull/{n}/head" for n in numbers]
    for start in range(0, len(refspecs), 100):
        batch = refspecs[start : start + 100]
        if not fetch(batch):
            for refspec in batch:
                fetch([refspec])


def prune_repo(repo: Path, apply: bool) -> bool:
    mode = "APPLY" if apply else "DRY RUN"
    print(f"\n== {repo} [{mode}] {datetime.now().isoformat(timespec='seconds')}")
    fetch = run(["git", "fetch", "--prune", "--quiet"], repo, check=False)
    if fetch.returncode != 0:
        print(f"fetch failed, skipping repository: {fetch.stderr.strip()}")
        return False
    head = run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo, check=False)
    trunk = head.stdout.strip() if head.returncode == 0 else "origin/main"
    print(f"trunk {trunk}")

    def read_branches() -> dict[str, dict]:
        fmt = "%(refname:short)%00%(objectname)%00%(upstream)%00%(upstream:track)"
        branches = {}
        for line in git(repo, "for-each-ref", "refs/heads", f"--format={fmt}").splitlines():
            name, tip, upstream, track = line.split("\0")
            branches[name] = {"tip": tip, "upstream": upstream, "gone": bool(upstream) and track == "[gone]"}
        return branches

    branches = read_branches()
    worktrees = list_worktrees(repo)
    branches_before, worktrees_before = len(branches), len(worktrees)
    gone = {name for name, info in branches.items() if info["gone"]}
    print(f"before: {branches_before} branches ({len(gone)} with upstream gone), {worktrees_before} worktrees")

    # Worktrees.
    cwds = process_cwds()
    removed_worktrees: list[dict] = []
    kept_worktrees: list[tuple[str, str]] = []
    for wt in worktrees:
        if wt["main"] or wt["branch_name"] not in gone:
            continue
        reason = worktree_block_reason(wt, cwds)
        if reason is None and apply:
            result = run(["git", "worktree", "remove", wt["worktree"]], repo, check=False)
            if result.returncode != 0:
                reason = f"git worktree remove failed: {result.stderr.strip()}"
        if reason is None:
            removed_worktrees.append(wt)
        else:
            kept_worktrees.append((wt["worktree"], f"{wt['branch_name']}: {reason}"))

    removed_paths = {wt["worktree"] for wt in removed_worktrees}
    checked_out: set[str] = set()
    for wt in list_worktrees(repo) if apply else worktrees:
        if wt["worktree"] in removed_paths or not Path(wt["worktree"]).is_dir():
            continue
        if wt["branch_name"]:
            checked_out.add(wt["branch_name"])
        if rebasing := rebasing_branch(wt["worktree"]):
            checked_out.add(rebasing)

    # Branch merge checks.
    kept: dict[str, str] = {}
    merged: dict[str, str] = {}
    candidates = sorted(gone - checked_out)
    for name in sorted(gone & checked_out):
        kept[name] = "checked out in a worktree"
    with ThreadPoolExecutor(max_workers=8) as pool:
        local = dict(zip(candidates, pool.map(lambda n: merged_locally(repo, trunk, branches[n]["tip"]), candidates)))
    remote_needed = [name for name in candidates if local[name] is None]
    with ThreadPoolExecutor(max_workers=4) as pool:
        heads = [branches[name]["upstream"].split("/", 3)[-1] for name in remote_needed]
        prs = dict(zip(remote_needed, pool.map(lambda head: merged_prs(repo, head), heads)))
    missing = sorted(
        {
            pr["number"]
            for found in prs.values()
            if isinstance(found, list)
            for pr in found
            if run(["git", "cat-file", "-e", f"{pr['headRefOid']}^{{commit}}"], repo, check=False).returncode != 0
        }
    )
    fetch_pr_heads(repo, missing)
    for name in candidates:
        found = prs.get(name, [])
        if local[name]:
            merged[name] = local[name]
        elif isinstance(found, str):
            kept[name] = found
        elif not found:
            kept[name] = "no merged PR and commits not in trunk"
        elif evidence := contained_in_pr(repo, branches[name]["tip"], found):
            merged[name] = evidence
        else:
            numbers = ", ".join(f"#{pr['number']}" for pr in found)
            kept[name] = f"local commits beyond merged PR {numbers}"

    deleted: dict[str, str] = {}
    for name in sorted(merged):
        if apply:
            result = run(["git", "branch", "-D", name], repo, check=False)
            if result.returncode != 0:
                kept[name] = f"git branch -D failed: {result.stderr.strip()}"
                continue
        deleted[name] = merged[name]

    if apply:
        branches_after, worktrees_after = len(read_branches()), len(list_worktrees(repo))
    else:
        branches_after = branches_before - len(deleted)
        worktrees_after = worktrees_before - len(removed_worktrees)

    verb = "removed" if apply else "would remove"
    print(f"worktrees: {verb} {len(removed_worktrees)}, kept {len(kept_worktrees)} (upstream gone)")
    for wt in removed_worktrees:
        print(f"  {verb}: {wt['worktree']} ({wt['branch_name']})")
    for path, reason in kept_worktrees:
        print(f"  kept: {path} ({reason})")

    verb = "deleted" if apply else "would delete"
    print(f"branches: {verb} {len(deleted)}, kept {len(kept)} (upstream gone)")
    for name, detail in sorted(deleted.items()):
        print(f"    {verb}: {name} {branches[name]['tip'][:12]} ({detail})")
    by_reason: dict[str, list[str]] = defaultdict(list)
    for name, reason in kept.items():
        groups = ("local commits beyond merged PR", "gh pr list failed")
        key = next((group for group in groups if reason.startswith(group)), reason)
        by_reason[key].append(name if key == reason else f"{name} ({reason})")
    for reason, names in sorted(by_reason.items(), key=lambda item: -len(item[1])):
        print(f"  kept, {reason}: {len(names)}")
        for name in sorted(names):
            print(f"    {name}")
    after_label = "after" if apply else "after (projected)"
    print(f"{after_label}: {branches_after} branches, {worktrees_after} worktrees")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="act; the default is a dry run")
    parser.add_argument("repos", nargs="*", type=Path, help="repositories (default: ~/code/yampa ~/code/omp-agents)")
    args = parser.parse_args()
    ok = True
    for repo in args.repos or DEFAULT_REPOS:
        top = Path(git(repo.expanduser(), "rev-parse", "--show-toplevel").strip())
        main_checkout = Path(list_worktrees(top)[0]["worktree"])
        try:
            ok = prune_repo(main_checkout, args.apply) and ok
        except RuntimeError as error:
            print(f"error in {main_checkout}: {error}")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
