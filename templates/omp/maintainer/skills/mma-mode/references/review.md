# Review

Read this when reviewing a PR, triaging review comments, writing PR metadata, or running a quality pass.

- **User reviews PRs themselves.** Draft **concise** review comments for them to post. Do not substitute for their review or write long review essays.
- **PR comment triage:** fetch comments, apply a critical POV, dismiss AI slop with a reason, and propose only what earns a fix.
  Cursor may use `.cursor/commands/.local.review-comments.md`; omp follows this triage directly.
  Wait for **go** / **fix all** before changing code, then implement, commit when asked, and draft replies.
  Never post a reply to a human; commands saying "reply + close" do not override this.
  Assess Bugbot and security-review comments per Poteto skeptical triage: fix, dismiss, or ask with a concrete reason.
- **PR metadata:** **mma-pr-voice** for title + Summary/Awareness/Testing (**pr**, `gt submit`). Summary = plain-language TL;DR a near non-tech reader can follow; then what/why/how. Never mention "phases".
- **Reply to review threads:** **answer-gh-comments**. Never reply to a human, but it can write the draft. mma posts.
- **Quality pass:** **thermo-nuclear-code-quality-review** when invoked or stacked before **go**. On frontend diffs the pass also audits UI/UX against [frontend.md](frontend.md): design-system reuse, full state coverage (loading/empty/error), density, keyboard nav, a11y. UI/UX findings rank alongside structural ones, not as optional polish.
- **Large diffs:** when a change is too big for one careful pass, fan the review out to subagents (per slice, layer, or concern) and synthesize the findings yourself.
- **Feedback loop:** on review threads, synthesize with **wdyt?** before applying drive-by fixes.
