---
status: accepted
date: 2026-11-24
decision-makers: user, agent
---

# A pull request fix goes to the session that owns it

In the context of the Pull requests page's **Fix CI and conflicts**, **Fix CI**, **Resolve conflicts**, and **Address comments**, its **Reply N** and **Fix CI N** buttons, and a PR shepherd's fixes, facing three separate "Address review threads on PR 7612" sessions in twenty minutes and a fix session started on a pull request whose original session already watched it, we chose to send the fix to the session that owns the pull request, as a follow-up while it runs and resumed once it ended, over a new session per click, so the fix lands in the session that has the branch, the worktree, and the choices behind them, accepting that an owner's transcript grows with each fix.

- The owner is, in order: the running session here whose task claim or transcript links the pull request, the session that watches it, then the ended sessions that kept its task claim, newest file first. Only a pull request with none of them, or none that resumes, starts a new session.
- A session another dashboard runs still fails the start with **Open session** or **End it and start again**, since this dashboard cannot send it a prompt.
- **Review** and **Thermonuclear review** keep starting their own session: a review is a separate task, and a code-quality review reads the work better from outside the session that wrote it.
- The fix prompts stay the same for an owner and a new session; their branch line says a new session runs in the worktree the dashboard checked out and an owner keeps its own, and a fix still ends its session once pushed, which the next fix resumes.
- A past session that opened the pull request but neither watched it nor held its task claim is not found: finding it would read every saved transcript's links on each click.

See [Starting sessions](../architecture/http-api-models-and-starts.md) and [Pull requests](../usage/pull-requests.md).
