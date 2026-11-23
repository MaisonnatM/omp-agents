---
name: dashboard-update
description: Load new commits into the running omp-agents dashboard through its update API. Use when the dashboard should pick up new commits or needs a restart.
---

# Dashboard update

To load new commits into the omp-agents dashboard, ask the dashboard, which fast-forwards its own checkout, installs packages when `bun.lock` changed, and restarts its server in place only when origin has new commits; the sessions it started keep running through the restart, and the window then reloads.
First read where it stands with `curl -sS -H "Authorization: Bearer $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token")" http://127.0.0.1:4317/api/dashboard/update`, using the port the user's dashboard runs on if not 4317.
Its `behind` counts the new commits on its branch as of the last fetch.
Its `failed`, when set, names the commit the desktop app went back from because it did not start, and why; updating refuses that commit with a 409 until origin moves past it, so report it rather than retry.
Then update with the same command plus `-X PUT -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d '{}'`.
A `current` answer means origin had nothing new and the dashboard did not restart; when it still needs a restart, ask the user rather than kill its processes.
A 409 answer says why the checkout stayed as it was, such as uncommitted changes or local commits; report it rather than stash, reset, or retry.
