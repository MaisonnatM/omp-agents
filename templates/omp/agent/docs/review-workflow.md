# Reviews and pull request descriptions

## Thermonuclear review

Thermonuclear review first produces incoming **Review triage** cards, not automatic fixes.
In a host-bound session, call `read_review_triage` before inspecting the review target.
For a new review, delegate the rubric to `thermonuclear-reviewer` without `isolated`.
Its `model: "@plan"` frontmatter follows `modelRoles.plan` and its fallback chain on any provider.
Request structured `summary` and `findings`, with each finding's number, path, line, original feedback, and evidence.
For an existing report, read the originating session file supplied by the host instead of running another review.
Preserve each finding's positive unique original number in `save_review_triage`'s `number` field and its unchanged wording in `feedback`.
Assess each item as `fix`, `push-back`, or `already-done`, draft replies with `maxence-voice`, and call `save_review_triage`.

In a Terminal session without `read_review_triage`, call `start_review_triage` with `existingReport: false` for a new review, or `true` for this session's existing findings.
The dashboard resolves the originating session and starts the bound capture.
Wait for the user's Accept or Dismiss decisions, then Apply accepted in the cards.
Only accepted fixes become code tasks; accepted pushback and already-done items produce reply drafts only.
The application session preserves unrelated staged, unstaged, and untracked work and records changed files, evidence, or a visible blocked reason.
Replies stay editable and Copy only.
Neither capture nor application authorizes commits, pushes, posts, thread resolution, PR-description edits, or PR creation.

Any later publishing or `/ship` continuation is a separate user-authorized action, not a consequence of review capture or Apply accepted.
PR capture may create a detached worktree at the actual reviewed head.
End session retains a checkout still needed by the latest complete triage; otherwise its normal cleanup removes clean, safe worktrees and keeps dirty changes.
Explicit removal in Settings → Worktrees invalidates that triage's checkout.
Before a later authorized commit and push, select or create the appropriate branch if the checkout is detached.
On that continuation, inspect the application's recorded results first: each fixed item's changed files and evidence, and each blocked item's reason.
Then commit and push the accepted changes, and only after the push add `- [x] Thermo-nuclear code quality review` to the PR body.
Put it under the body's existing checklist, else under a `## Checks` heading, and always above any `<!-- CURSOR_SUMMARY -->` block.
Neither capture nor Apply accepted adds the checkbox.

## PR description layout

Use bullets or an aligned `text` code block for comparisons, rather than markdown pipe tables.
GitHub renders a PR description's table with `display: block; width: max-content`, so it shrink-wraps narrower than surrounding prose and code blocks.
For before-and-after evidence, use the `pr` skill's bullet shape: `**Before:** ... **After:** ...`.

## PR screenshots

Attach screenshots and videos with `gh pr edit <N> --attach './shot.png#Alt text'` (`gh` v2.99.0 or later); `gh pr create --draft` and `gh pr comment` take the same flag.
It uploads to `github.com/user-attachments/assets/…`, which keeps the repository's visibility, and rewrites any `![alt](./shot.png)` in `--body-file` to the uploaded URL; otherwise it appends the image.
Each `![alt](path)` in the body must use the exact path string given to `--attach`: for `--attach './shot.png#Alt text'` write `![Alt text](./shot.png)`, since `shot.png` or an absolute path does not match and the image is appended at the end instead.
When the cwd is not the PR's repository, pass `-R owner/repo`, or `gh` looks for the PR in the cwd's repository.
In a Graphite repository, run `gt submit --draft` first, then `gh pr edit`: `gt submit` leaves an existing PR's description alone unless given `--edit-description`.
Never commit images to an assets branch or link Linear upload URLs, which expire after five minutes.
`--attach` rewrites only markdown `![alt](./shot.png)` references, not HTML `<img src>`: for a sized or side-by-side layout, attach first, then put the appended `user-attachments` URLs into the `<img>` tags and remove the appended lines.
