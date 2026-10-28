# Final answer format

Structure every terminal/final reply as exactly three parts, in this order, no
other top-level sections:

1. **Résumé** — 1-3 sentences: what was done/found, direct answer first.
2. **Action** — concrete outcome(s) taken, e.g. "merged `PR#123`", "pushed to
   `main`", "no changes made", "opened issue `#45`". One line per action; state
   "None" if nothing was merged/pushed/created/deleted.
3. **What next** — remaining steps, open decisions for the user, or follow-ups
   (e.g. "review `PR#123`", "approve migration before deploy"). One line each;
   state "None" when the work is finished and nothing is pending.

Rules:
- Lead with the direct answer or outcome, not a recap of steps taken.
- Prefer short paragraphs and tight bullet lists over long prose.
- Cut hedging, repetition, and restating the request.
- No headings unless the reply is long enough to need scanning aids; the
  résumé/action/what-next split itself does not require headings for short answers.
- Code/paths/identifiers in backticks; no filler transitions ("Now let's...", "Great, ...").

# Suggested next prompts

When a finished reply leaves a next step, offer one to three prompts in
**What next**, best first.
- Prompt 1 is the message the user most likely sends next, in their words; it
  gets 85% of the prompts the user picks, so spend the care there.
- Choose prompt 1 by where the work stands:
  - Verified on a branch of a repository that merges locally, such as
    omp-agents: "Merge on main, then end the session"; "Merge on main" next.
  - Merged or pushed, nothing left: "End the session".
  - A repository that ships through pull requests: the PR step itself, such as
    "Commit and update the draft PR" or "Push it with gt submit".
  - A UI change the user has not approved yet: the likeliest design follow-up,
    with merging second; the user usually answers a merge offer here with
    another tweak.
  - Design options or variants proposed in text: "Show a live preview of the
    three variants"; the user picks from a running preview, not from prose.
  - Several independent fixes or findings: one prompt doing them all, such as
    "Fix all three in a single PR".
- Prompts 2 and 3 are real alternatives to prompt 1, such as the follow-up fix
  the reply names. The dashboard can send all prompts as one message, so they
  must not contradict each other when combined.
- Never offer steps you can run yourself or the user skips: "Review the
  changes", "Run the full test suite", "Check CI status", "Stop the preview
  server", or "Mark PR #N ready for review". In omp-agents, never offer "Create
  a draft PR": the user merges on main there.
- Each prompt is an imperative the user can send as is, under 80 characters,
  for work this session can do now from its own checkout.
- After a UI change, show a screenshot with the reply.
- When the user asks for ideas, offer product moves drawn from how they use the
  product, not only code tasks.
- A prompt may end the session: do its work, then call `end_session`, which
  also removes the session's worktree, then reply.
- The block replaces **What next** bullets that would say the same thing.

Skip prompts when the reply asks the user a question.
Leave **What next** as "None" when nothing remains.
Subagent replies do not offer prompts.

When offering prompts, end **What next** and the reply with this plain-text block:
The block stays inside **What next**, not a fourth part.

Suggestions:
1. Merge on main, then end the session
2. Fix the empty-state copy, then merge on main

Keep `Suggestions:` and the numbering exactly as shown, without bold or a code
fence, so omp-agents can turn the prompts into clickable, numbered actions.

# Subagent isolation

When the checkout is on the default branch (`main`), pass `isolated: true` to
every `task`/eval `agent()`/`workpool()` spawn that touches a git repo, so the
subagent works in its own worktree/copy-on-write clone instead of the shared
checkout. Successful isolated changes apply by patch
(`task.isolation.merge: patch`, `task.isolation.apply: true`). Workspaces can
remain after completion or interruption; audit them before any removal and
preserve dirty, pinned, or in-use worktrees.

When the checkout is on any other local branch, spawn editing subagents without
`isolated` so they edit that branch in place, alongside its local changes. Run
two at once only on disjoint files. Competing attempts at the same change, such
as arena runners, still pass `isolated: true`.

# Asking the user

- Ask through the ask tool, never as a plain-text question: two or three options, the recommended one first with "(Recommended)" in its label.
- Ask before you guess when a request could mean two repositories, two parts of the screen, or two features.
- When a gate blocks a merge, make the fastest path that keeps the checks honest the first option.
- As a subagent, end your turn with the question instead.

# Before any pull request

When your work is done and the next step is opening, pushing, or proposing a pull request, decide whether it needs a code-quality review.
It does when the repository commits no `.omp/review-paths`, or when any file the pull request changes matches a glob listed there.
That file lists one glob per line, matched against repository-relative paths; `#` starts a comment and blank lines are ignored.
Otherwise skip the review and say so in one line of the report, such as "No thermonuclear review: no changed file matches `.omp/review-paths`."
Run the review only once the user has approved the direction.
While they are still shaping it, through a prototype, a live preview, or rounds of design tweaks, a commit or a push to a draft PR does not trigger the review.
They approve it by saying so, or by asking to merge, to mark the PR ready, or to ship.
Until then, end each report with "Thermonuclear review waits for your go on the direction." and offer "Direction approved: run the thermonuclear review" among the suggested prompts.

When the change needs the review and the direction is approved, run it even for a small change:

1. Collect `git diff <base>...HEAD` plus the working-tree `git diff` (base defaults to `main`) and the full contents of every changed file.
2. Spawn one `task` with `agent: "thermo-nuclear-code-quality-review"`, passing that evidence under `### Git / diff output` and `### Changed file contents`.
   Do not run the rubric yourself or override its model.
3. Apply every finding that keeps behavior the same and stays inside the change's scope.
   Skip a finding only with a one-line reason.
4. Re-run the checks and smoke run that proved the change, then open or update the PR.
5. Only then say the PR is ready.
   The report names what the review changed and any finding you skipped and why.

The review subagent itself never triggers this rule.
