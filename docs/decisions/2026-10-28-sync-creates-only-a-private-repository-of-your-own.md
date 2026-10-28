---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Sync creates only a private repository of your own

In the context of **Create private repository on GitHub** in Settings › Sync, facing a name that may already exist, we chose to take an existing repository only when it belongs to the signed-in `gh` account and is private, and to refuse a public one or another account's, over taking any repository the account can push to.
Sync pushes prompts, skills, and settings, so this keeps them from landing where others can read them, accepting that someone who wants a public repository or an organization's existing one types its address into **Remote** and saves it instead.
