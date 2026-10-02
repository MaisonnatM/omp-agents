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

# Subagent isolation

For every `task`/eval `agent()`/`workpool()` spawn that touches a git repo, pass
`isolated: true` so the subagent works in its own worktree/copy-on-write clone
instead of the shared checkout. Successful isolated changes apply by patch
(`task.isolation.merge: patch`, `task.isolation.apply: true`). Workspaces can
remain after completion or interruption; audit them before any removal and
preserve dirty, pinned, or in-use worktrees.
