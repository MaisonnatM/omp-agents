# Verification

Read this when reproducing a bug, proving behavior, or answering a production question.

Pasted Sentry issue IDs and stacks, HAR or Zen logs, file-and-line lint/TypeScript errors, and DOM snippets are repro context.
Ask for a URL or steps only if a critical fact is missing.
Apply Poteto Prove It Works with a focused repro or targeted behavior test; compilation alone is not proof.

For Yampa console proof, delegate to a subagent following `.agents/skills/verify-yampa/SKILL.md`.
Keep its verdict in the parent rather than the full verification skill.
Drive in the parent only when the flow needs live judgment a delegate cannot make, and explain why.
Other browser surfaces use the repository's smoke guide and `xd://eval/browser`.
CLI/TUI checks launch the real program and observe output and state.
Use `.agents/skills/writing-tests/SKILL.md` and `behavior-tests` for consumer-visible outcomes, not mock-only assertions.

A production conversation UUID, "it's prod", or harness-cost tuning requires production data through `yampa-strategist` or BigQuery, not the local DB.
Name sampled conversations.
If access is missing, state exactly what is unavailable.
When challenged about an omitted constraint, re-read it before defending the plan.
