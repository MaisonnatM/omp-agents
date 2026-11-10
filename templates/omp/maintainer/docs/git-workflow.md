# Git workflow

## Create a worktree

Create the branch on its parent under `~/code/<repo>-wt/<topic>`:

```sh
git worktree add -b <branch> ~/code/<repo>-wt/<topic> <parent>
```

## Resolve conflicts in a rebase

A rebase stops once per conflicting commit; repeat these steps until no commit stops:

1. List the conflicted files with `git diff --name-only --diff-filter=U`.
2. `read` a file's `:conflicts` before writing `conflict://`; each stop needs a fresh read.
3. To take a whole side, run `git -c core.hooksPath=/dev/null checkout --theirs -- <file>`.
   During a rebase `--ours` is the base and `--theirs` is the branch's commit.
   A post-checkout hook, such as yampa's pre-commit one, fails the plain command with `Unmerged files` after it took that side.
4. Format a resolved file, then `git add` it.
5. Continue with `GIT_EDITOR=true git rebase --continue`.

## Create drafts before publishing

Push the branch with `git push -u origin <branch>`, then create the PR as a draft with `gh pr create --draft`.
Set or change the PR title and body with `pr_description`. `gh pr edit` is only for `--attach`, and it takes no `--body` or `--body-file`.
The ship extension blocks publication until a thermonuclear review is applied and pushed, unless the repository commits `.omp/review-paths` and the PR changes no file its globs match.
When the review applies, run the thermonuclear stage once the user approves the direction, commit and push its fixes, then add `- [x] Thermo-nuclear code quality review` to the PR body.
When the repository commits `.omp/ui-paths` and a changed file matches it, the interface review runs first the same way and earns `- [x] Interface review`.
Follow `~/.omp/agent/docs/review-workflow.md` for when the review applies and for the review and checkbox rules.
When the interface review applies, the extension also blocks while the body has an unchecked `- [ ] Browser proof` box, which yampa's PR template declares.
Then run the verify-yampa skill, attach a screenshot of the changed UI with `gh pr edit <N> --attach` and no body flag, and check the box with `pr_description`; when the interface review does not apply, delete the line with `pr_description`.
The extension checks the box, not the screenshot.
Only then run `gh pr ready <N>`; the extension asks the user to approve before the command runs.
A new branch has no PR body to check: create its draft first rather than retrying publication.
Authentication or network errors still require fixing the reported access failure, not creating another PR.

## Stack PRs as base-branch chains

A stack is a chain of branches, each cut from the one below it, with each PR opened on its parent's branch: `gh pr create --draft --base <parent-branch>`.
When a parent branch changes, run `git rebase <parent-branch>` in the child's worktree and resolve conflicts as above; pushing the rebased child is a force-push, which needs the user's approval.
