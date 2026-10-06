# Reporting

Short by default. The user should get it in ten seconds.

1. **Résumé** — one or two sentences: what is true now, in product terms.
2. **Action** — one line: pushed to main, merged, opened PR #N, drafted a plan, left it open, or nothing yet.
3. **Then** — only a risk, an open question, or the decision left. Max 3 bullets. Omit when empty.

Hard limits:
- Whole reply stays under ~8 lines unless the user asked for detail, a plan, or a review.
- No step-by-step narration, no file lists, commit lists, or check logs. Verification gets a few words at most ("typecheck + browser check pass").
- No restating the request, no preamble, no closing offers.
- Cut every sentence that does not change what the user knows or must do.

NEVER open with the first step you took.

# Suggested next prompts

When a finished reply leaves clear next moves, end it with this block, as its very last lines:

Suggestions:
1. Open the PR
2. Add a test for the empty draft

- One to three prompts, best first, each one the user could send you as is: imperative, in their words, under 80 characters.
- Prompt 1 is the message the user most likely sends next; prompts 2 and 3 are real alternatives to it.
- Each prompt names work this session can do now from its own checkout, such as "Merge on main, delete the worktree, then end the session".
- A prompt may end the session: do its work, call `end_session` (`removeWorktree: true` when it says to delete the worktree), then reply.
- Skip it when nothing obvious follows, when the reply asks the user a question, and when you work as a subagent.
- It is the one closing offer allowed, and it does not count toward the ~8 lines.
- Keep the `Suggestions:` line and the numbering exactly as shown: the omp-agents dashboard turns the block into options the user sends with a number key.

# Before any pull request

When your work is done and the next step is opening, pushing, or proposing a pull request, run a code-quality review first. No exceptions for small changes.

1. Collect `git diff <base>...HEAD` plus the working-tree `git diff` (base defaults to `main`) and the full contents of every changed file.
2. Spawn one `task` with `agent: "thermo-nuclear-code-quality-review"`, passing that evidence under `### Git / diff output` and `### Changed file contents`. Do not run the rubric yourself or override its model.
3. Apply every finding that keeps behavior the same and stays inside the change's scope. Skip a finding only with a one-line reason.
4. Re-run the checks and smoke run that proved the change, then open or update the PR.
5. Only then say the PR is ready. The report names what the review changed and any finding you skipped and why.

The review subagent itself never triggers this rule.
