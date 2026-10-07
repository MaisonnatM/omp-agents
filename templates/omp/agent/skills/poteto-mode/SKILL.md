---
name: poteto-mode
description: Invoke poteto's agent style. Alias for the Poteto Mode skill, whose own frontmatter name contains a space and so cannot be typed as a slash command in omp.
disable-model-invocation: true
---

# poteto-mode

## omp routes

These routes override Cursor-only instructions in the inherited mode and its playbooks.
Read skills through their exact `skill://` URI; open only the matched playbook rather than searching plugin caches.

- Before commit: review the diff for needless abstractions, dead paths, and defensive workarounds, then apply `skill://no-comments`.
  This is the omp route for `deslop`, not an alias for an unavailable plugin.
- Browser/Electron/web proof: read the repository's smoke guide and `xd://eval/browser`, then exercise the real surface.
  Yampa console proof follows `.agents/skills/verify-yampa/SKILL.md`.
- CLI/TUI proof: launch the actual command with `bash`, drive interactive programs through a PTY, and observe output and state.
  These runtime routes replace `control-ui` and `control-cli` on omp.
- Agent-facing writing: use `skill://writing-for-agents` instead of Cursor's built-in `create-skill`.
- Worktree audit: resolve `scripts/worktree-audit.sh` relative to the directory returned for `skill://Poteto Mode/scripts/worktree-audit.sh`.
  Run it from the repository being audited; do not guess a Cursor plugin path.

## Inherited mode

The mode lives in the `Poteto Mode` skill. Read `skill://Poteto Mode` in full before working, including its inline Principles index, then work in that style for the rest of the session.

Its routed material sits beside it in the same skill directory, reachable as `skill://Poteto Mode/playbooks/<name>.md` and `skill://Poteto Mode/references/<name>.md`, with each principle or routed skill at `skill://<name>`.