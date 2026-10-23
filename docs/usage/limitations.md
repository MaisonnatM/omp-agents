# Limitations

In a terminal session, the dashboard cannot run omp's built-in `/` commands or the `!` shell shortcut: Collab accepts guest prompts, not host-side TUI commands.
No session runs the `$` Python shortcut from the dashboard, and only the omp terminal runs `!!`.
The composer says so under a draft that starts with one of them and does not send it, instead of sending literal text to the agent.
Run them in the omp terminal.
