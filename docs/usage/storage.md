# Storage

- **Storage** is a section of [Settings](settings.md), at `#settings/storage`, that measures session files, attachments, and isolation sandboxes across all workspaces.
  Open it from the disk reading's **Clean up…** link in the sidebar's foot.
  The checklist previews old reports and replicas, unused attachments, cold sessions to archive, idle files to compress, database logs, sandboxes of ended tasks, sandboxes of ended tasks with leftover changes, and package caches.
  It starts with your saved cleanup switches, plus sandboxes of ended tasks; empty phases, sandboxes with leftover changes, and package caches stay unchecked.
  **Check again** refreshes the preview without deleting anything.
  Sizes are approximate; cold sessions show a count, and compression shows the files' current disk use rather than promised savings.
  Sandboxes fill in separately, and can take a few minutes when many are left over.
  Their sizes read **Up to**, since a sandbox shares some files with your checkout and the package cache, so they stay out of the **Clean up about** estimate.
  A sandbox whose copy of your repository omp keeps in ovnfs, outside the sandbox, reads **Size unavailable**, since ovnfs cannot say how much removing that copy frees.
  **Sandboxes of ended tasks with leftover changes** are ones whose task ended with edits still in them; removing them deletes edits omp did not bring back to your checkout.
  **Kept** lists the ones a live owner, a Git lock, or another safety check protects.
  **Package caches** covers the caches of uv, pnpm, and bun, whichever are installed, and runs each tool's own prune: `uv cache prune`, `pnpm store prune`, and `bun pm cache rm`, which empties bun's cache.
  Its size reads **Up to**, since your projects' environments share some of a cache's files, and stays out of the estimate; pruned packages download again when a project needs them.
  uv's prune skips uv's lock, which every running `uvx` tool, such as an MCP server a session starts, holds for its whole life, and the entries a running process has open come back after the prune.
  When some cache files belong to another user, as after a `sudo` install, the row's error names the `chown` command that fixes them.
  **Clean up** asks for confirmation and names what cannot be undone.
  Archived cold sessions leave the roster, History, and Resume, while their compressed archive stays on disk.
  Cleanup follows omp's phase order, then rechecks and removes the chosen sandboxes one at a time, then prunes the package caches.
  **Stop after this step** lets the current operation finish and starts no more.
  Leaving Settings or reloading also prevents later steps, but does not kill the operation already running.
  A failed step keeps its error on the row and stops the rest; **Check again** keeps the checklist's ticks for another attempt.
  The result shows the native counts and the volume's free space before and after, not a promise that all selected bytes were freed.
  **Cleanup rules** edits all twelve native cleanup settings through the same conflict-checked settings writer as **omp settings**.
  Each rule saves separately; number fields save on Enter or when you leave the field, and Escape restores the value.
  **Reset** removes your override and restores omp's default.
  A conflict reloads the value changed on disk and asks you to review it before trying again.
  The rules and dashboard cleanup are global; a selected workspace's overrides show a warning and apply only to terminal cleanup in that folder.
  No new daily cleanup runs.
  **Compress daily** runs only when you launch omp in a terminal, not for dashboard sessions, and shows the last background compression log when one exists.
  The existing daily sandbox sweep stays in place, and never removes a sandbox with leftover changes.
  Merged Git worktrees keep their separate review in **Worktrees**.
