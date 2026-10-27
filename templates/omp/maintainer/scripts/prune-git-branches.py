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
     local tip or the same patches. Graphite-tracked branches go through `gt delete`
     (children first; `gt untrack` + `git branch -D` when Graphite calls the metadata
     orphaned or diverged) so Graphite's metadata is cleaned; a tracked branch with a kept child
     is kept.
     Everything else is kept and listed with the reason.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

DEFAULT_REPOS = [Path.home() / "code" / "yampa", Path.home() / "code" / "omp-agents"]
# omp-agents never uses Graphite, even if a config file appears there.
NO_GRAPHITE_REPOS = {"omp-agents"}
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


def gt_error(result: subprocess.CompletedProcess[str]) -> str:
    lines = (result.stderr + result.stdout).splitlines()
    return next((line for line in lines if line.startswith("ERROR")), lines[-1] if lines else "no output")[:200]


def delete_branch(repo: Path, name: str, tracked: bool) -> tuple[str, str | None]:
    """Delete `name`, cleaning Graphite metadata first when it has any. Returns (method, error)."""
    method = "git branch -D"
    if tracked:
        result = run(["gt", "delete", name, "--force", "--quiet", "--no-interactive"], repo, check=False)
        if result.returncode == 0:
            return "gt delete", None
        # Graphite refuses metadata whose parent is gone ("untracked") or whose recorded
        # parent revision no longer matches ("diverged"); untrack those, then delete.
        if not any(state in gt_error(result) for state in ("untracked branch", "diverged branch")):
            return "gt delete", f"gt delete failed: {gt_error(result)}"
        result = run(["gt", "untrack", name, "--force", "--quiet", "--no-interactive"], repo, check=False)
        if result.returncode != 0:
            return "gt untrack", f"gt untrack failed: {gt_error(result)}"
        method = "gt untrack + git branch -D"
    result = run(["git", "branch", "-D", name], repo, check=False)
    if result.returncode != 0:
        return method, f"git branch -D failed: {result.stderr.strip()}"
    return method, None



def graphite_parents(common_dir: Path) -> dict[str, str | None] | None:
    db = common_dir / ".graphite_metadata.db"
    if not (common_dir / ".graphite_repo_config").is_file() or not db.is_file():
        return None
    with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
        return dict(conn.execute("select branch_name, parent_branch_name from branch_metadata"))


def trunk_ref(repo: Path, common_dir: Path) -> str:
    config = common_dir / ".graphite_repo_config"
    if config.is_file():
        trunk = json.loads(config.read_text()).get("trunk")
        if trunk:
            return f"origin/{trunk}"
    head = run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo, check=False)
    return head.stdout.strip() if head.returncode == 0 else "origin/main"


def prune_repo(repo: Path, apply: bool) -> bool:
    mode = "APPLY" if apply else "DRY RUN"
    print(f"\n== {repo} [{mode}] {datetime.now().isoformat(timespec='seconds')}")
    fetch = run(["git", "fetch", "--prune", "--quiet"], repo, check=False)
    if fetch.returncode != 0:
        print(f"fetch failed, skipping repository: {fetch.stderr.strip()}")
        return False
    common_dir = Path(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir").strip())
    trunk = trunk_ref(repo, common_dir)
    parents = None if repo.name in NO_GRAPHITE_REPOS else graphite_parents(common_dir)
    print(f"trunk {trunk}; graphite {'yes' if parents is not None else 'no'}")

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

    # Graphite: delete children before parents; keep a tracked parent of any kept branch.
    tracked = parents or {}
    children: dict[str, set[str]] = defaultdict(set)
    for child, parent in tracked.items():
        if parent and child in branches:
            children[parent].add(child)
    changed = True
    while changed:
        changed = False
        for name in sorted(merged):
            if name in tracked:
                blocker = next((c for c in sorted(children[name]) if c not in merged), None)
                if blocker:
                    kept[name] = f"Graphite parent of kept branch {blocker}"
                    del merged[name]
                    changed = True

    order: list[str] = []
    pending = set(merged)
    while pending:
        ready = sorted(n for n in pending if not (children[n] & pending))
        order.extend(ready)
        pending -= set(ready)

    deleted: dict[str, str] = {}
    for name in order:
        if blocker := next(iter(sorted(children[name] & kept.keys())), None):
            kept[name] = f"Graphite parent of kept branch {blocker}"
            continue
        if apply:
            method, error = delete_branch(repo, name, name in tracked)
            if error:
                kept[name] = error
                continue
        else:
            method = "gt delete/untrack" if name in tracked else "git branch -D"
        deleted[name] = f"{method} ({merged[name]})"

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

    by_method: dict[str, int] = defaultdict(int)
    for detail in deleted.values():
        by_method[detail.split(" (")[0]] += 1
    verb = "deleted" if apply else "would delete"
    methods = ", ".join(f"{count} via {method}" for method, count in sorted(by_method.items()))
    print(f"branches: {verb} {len(deleted)} ({methods or 'none'}), kept {len(kept)} (upstream gone)")
    for name, detail in sorted(deleted.items()):
        print(f"    {verb}: {name} {branches[name]['tip'][:12]} via {detail}")
    by_reason: dict[str, list[str]] = defaultdict(list)
    for name, reason in kept.items():
        groups = ("local commits beyond merged PR", "Graphite parent of kept branch", "gh pr list failed")
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
