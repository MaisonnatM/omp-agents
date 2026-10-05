# Git and Graphite workflow

## Detect Graphite before creating a branch or opening a PR

Run from the repository or its linked worktree:

```sh
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
test -f "$git_common_dir/.graphite_repo_config"
```

A successful `test` means the repository uses Graphite.
In a linked worktree, `.git` is a file pointing to worktree-specific metadata; Graphite's repository configuration belongs in the shared Git directory.
`--path-format=absolute` makes the result independent of the current subdirectory.
If Graphite is configured, prefer `gt create` and `gt submit`; `git worktree add` alone does not register a branch with Graphite.

## Register every branch with an open PR

Graphite never auto-discovers a PR opened through plain `git` and `gh pr create`.
Immediately after creating a PR or noticing an untracked one, register the branch under its actual parent and submit its metadata:

```sh
gt track <branch> -p <parent-branch> --no-interactive -q
gt submit --cwd <worktree-or-repo-path> --no-edit --no-stack -q
```

Before treating a branch created outside Graphite as registered, complete both commands.
When `git rev-parse <branch>` matches `git rev-parse origin/<branch>`, `gt submit` attaches the existing PR to Graphite without force-pushing or creating a duplicate PR.
If the branch has no dedicated worktree and the current checkout is dirty, create a throwaway worktree on that branch, submit from there, then remove it only after confirming it has no changes.
Keep the dirty checkout intact; do not switch its branch.

Periodically compare `gh search prs --author <you> --state open --json number,repository` with `gt state`'s tracked-branch keys.
Use `--assignee` instead when auditing review-assigned PRs.
