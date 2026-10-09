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

## Create a worktree in a Graphite repository

Create the branch on its parent, then track it before the first commit:

```sh
git worktree add -b <branch> ../<repo>-<topic> <parent>
gt track <branch> -p <parent> --cwd ../<repo>-<topic> --no-interactive -q
```

A branch Graphite does not track fails `gt modify`, `gt restack`, and `gt submit` with "Cannot perform this operation on untracked branch"; run the `gt track` above, never fall back to `git commit --amend`.
When the parent is itself untracked, track it first, from the bottom of the stack up.
"<parent> is not in the history of <branch>" means the branch was not cut from that parent: run `git rebase <parent>` in the branch's worktree, then `gt track`.
A warning that branches "diverged from Graphite's tracking" concerns the branches it names; ignore it unless it names your stack.
Read the stack with `gt log short --stack`; `gt log` and `gt state` print every tracked branch in the repository.

## Create drafts before publishing

Create the PR as a draft with `gt submit --draft` when Graphite is configured, or `gh pr create --draft` otherwise.
The ship extension blocks publication until a thermonuclear review is applied and pushed.
Run the thermonuclear stage, commit and push its fixes, then add `- [x] Thermo-nuclear code quality review` to the PR body.
Follow `~/.omp/agent/docs/review-workflow.md` for the review and checkbox rules.
Only then request ready-gate approval and run `gt submit --publish` or `gh pr ready <N>`.
A new branch has no PR body to check: create its draft first rather than retrying publication.
Authentication or network errors still require fixing the reported access failure, not creating another PR.

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
