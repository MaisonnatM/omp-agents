# Settings

- The sidebar's **Settings** row opens **Settings**; Cmd+, does the same, and pressing it again returns to the panes.
  While Settings is open the sidebar lists its sections under its **Settings** row; select another row, such as **Sessions**, to leave.
  The sidebar lists twenty sections in four groups.
  **Usage** holds **Analytics** and **Activity**, **General** holds **Preferences**, **Workspaces**, **Sync**, **Phone access**, and **Storage**, and **Connections** holds **Providers**, **Integrations**, **MCP servers**, and **Source control**; these are the same whatever the workspace.
  **This workspace** holds **Models**, **Agents**, **omp settings**, **omp memory**, **Files**, **Extensions**, **Workflows**, **Decisions**, and **Worktrees**, which show omp's config and files, package discovery, and the repository's records and worktrees, as a session in the sidebar's workspace sees them; only these sections show the workspace picker.
  The command menu finds a section by its name or by what it holds, such as "theme" or "github", under **Settings**.
  The gear button and Cmd+, reopen the section you last had open in this app, **Analytics** the first time, and the header names the open section.
  Switching sections keeps an unsaved edit and opens the new section at its top, and the selected section stays when you change workspace.
- **Analytics** shows request usage for the last 24 hours.
  Choose **Today**, **24h**, **7d**, **30d**, **90d**, or **All** to change the range; **Today** starts at local midnight.
  Each range's last result is cached in the app, so switching back, reopening the page, or reloading shows it while a fresh read runs.
  A failed refresh keeps the cached result and shows the error.
  Refreshes run only while **Analytics** is open, every five seconds during indexing and every 30 seconds otherwise.
  While a range with no cached result loads, the previous range's numbers remain visible but dimmed.
  It shows tokens, estimated cost, requests, cache hit rate, and a chart of token usage over time.
  The cost is omp's API-equivalent list price, not what your subscription bills.
  It counts requests recorded by omp, Claude Code, and Codex, including their subagents.
  Claude Code and Codex costs use omp's model catalog, and a model it does not know costs zero while its tokens still count.
  The chart stacks token usage by the provider that handled each request, with a fixed color and a legend entry for each provider.
  Hover or tap a time bucket to see its total and each provider's tokens, estimated cost, and requests.
  Focus the chart and use Left or Right to move between buckets; Escape closes the details.
  **View bucket data** shows the same numbers in a table, including empty buckets and requests that recorded no tokens.
  The **Today** and **24h** charts label local hours; daily charts label UTC dates.
  Models and workspaces that used tokens in the range are ordered by tokens, followed by the token split among main agents, subagents, and advisors, and by tool calls.
  Tool calls remain omp-only.
  The top 20 sessions include their subagents' usage; select a session to open it.
  omp keeps the usage of a session whose transcript you deleted, so it stays listed as **Deleted session**, without a link.
  It covers every session whatever workspace the header picks.
  omp indexes session files when you first open **Analytics** and updates the tab while indexing continues.
  New omp requests appear as omp syncs them, including requests from sessions started outside the dashboard.
  Claude Code and Codex transcripts refresh on each Analytics read.
  **Context sources**, below the usage, ranks what fills each request's input over the same range: instruction files such as `AGENTS.md`, skills, rules, MCP servers, system prompt sections, injected messages such as reminders, each tool's results, and the conversation itself.
  Each row shows the source, its kind, its average tokens per request that carried it, those requests, its total tokens, its estimated cost, and its share of input.
  Tokens count cache reads and writes as input, so the rows add up to the requests' input tokens.
  The cost splits each request's input, cache read, and cache write cost by each source's tokens, so a source sent mostly from cache costs less per token.
  Choose a workspace to narrow the report to its sessions and their subagents, and a session to see that session's top sources.
  A main session's transcript records neither its system prompt nor its tool definitions, so their tokens show together as **System prompt and tool definitions**, under **Not in transcript**; a subagent's transcript records its system prompt, so its files, skills, rules, and MCP servers show by name, and only **Tool definitions** stay unrecorded.
  Tokens come from omp's tokenizer for each model, or from OpenAI's o200k encoding for a model omp has none for.
  The report reads every session file once, then only the files that changed, and shows how far it has read while it catches up; after omp updates, it reads them all once more, since omp's new tokenizer may count differently.
- **Activity** shows how you use the dashboard over the last 30 days; choose **Today**, **24h**, **7d**, **30d**, **90d**, or **All** to change the range.
  It counts the pages and settings sections you open, the shortcuts and command menu commands you run, the changes you send, and clicks on a few controls that change nothing else, by name only, never what they show or what you typed.
  **Not used** lists every feature with no use in the range and when you last used it, or **Never**; features used once or twice follow.
  The pages, commands, and changes of a service omp is not signed in to, such as **Email** and its commands without Gmail, are listed apart and not counted.
  **Most used** lists the top 20 features, with how many days you used each and, for a command, how often you ran it by its keys and from the command menu.
  **Navigation** lists the 15 most common moves from one view to another and the time spent on each view.
  **Active time** charts the minutes you used the dashboard each day, up to five minutes between two uses, with a table of each day's active time, visits, and changes sent.
  Only the server that runs the unattended work keeps activity, in `activity.db` in its data directory; a browser under automation records nothing.
- **Storage** measures session files, attachments, and isolation sandboxes, and cleans them up with omp's cleanup and the package caches; see [Storage](storage.md).
- **Worktrees** lists every Git worktree in repositories where a session ran; **Show another repository**, below the list, lists one more.
  A session directory that is gone or outside Git is skipped; a path you enter that is not in a repository says so.
  Above the list, the tab counts the worktrees, their disk use measured so far, and the merged ones with their size; **All**, **Merged**, and **Removable** filter the rows.
  Each row shows the branch, the path below the repository's parent folder with the full path on hover, the last time an omp session file in that checkout changed, the last commit, approximate disk use, and tracked or untracked changes.
  No omp session reads as no omp session, not as unused.
  Rows keep their order while sizes are measured and sort again once every size is in or you change the sort.
  A badge after the branch names what blocks deleting a checkout, with the full reason on hover; each repository's header checkbox selects every deletable row.
  Selected rows show a bar at the bottom of the page with their count, size, **Clear**, and **Delete N worktrees**.
  A row's **Delete**, or **Forget** for a registration whose directory is already gone, reads **Confirm?** after the first click, and a second click within three seconds queues it; the selection bar's button reads **Confirm deletion of N?** the same way and clears the selection once it queues them.
  Queued worktrees are removed one at a time, even after you leave the page: the row reads **Queued**, then **Removing** beside a spinner, and leaves the list once it is gone.
  One toast counts the run, such as `Removing 2 of 5 worktrees` with the branch it removes now, then sums it up, such as `Removed 4 of 5 worktrees` with how many it kept or failed to remove; a single worktree's toast says how its removal ended.
  A worktree you picked that turns out blocked, and one whose removal fails, also toast on their own with the reason.
  Removal keeps the branch and session transcripts.
  It refuses the main checkout, a locked checkout, unsaved changes, a nested repository, and a checkout this dashboard, a live session, or a resident subagent uses.
  Subagent blockers name the session and subagent. Known default and Bash working directories protect their containing checkouts, not unrelated siblings.
  Missing or incomplete subagent evidence and disconnected rosters keep repository-wide protection. If the repository is unknown too, every checkout stays protected.
  Ignored files such as dependencies and `.env` are deleted with the checkout, as each button's tooltip says.
  A worktree whose detached commit no branch, tag, or remote holds is kept, with a toast that says so, since removing it could lose that commit.
  The page cannot see every shell or editor, so close other tools using a checkout before you delete it.
  Disk use is approximate, and removing a checkout may free less than the number shown.
  A row whose work has merged says **Merged** after its branch, with the pull request's number when GitHub's newest pull request from that branch merged.
  A worktree counts as merged when `origin`'s default branch contains its commit, which also covers a detached checkout, or when its branch's newest pull request merged and the branch has no commit made after the merge, which covers squash merges.
  The main checkout is never flagged, and repositories GitHub cannot answer for share one warning above the list, while the default branch still flags what it contains.
  **Remove N merged** shows while N merged rows that the search and filter show have no blocker badge, and reads **Confirm removal of N?** after the first click; a second click within three seconds queues them as **Delete** does.
  It keeps a worktree with unsaved changes, one a live session uses, one whose work it cannot show merged, and everything **Delete** refuses, and counts those in its last toast.
  The button reads **Removing…** beside a spinner and waits while any removal is queued or running.
- **Models** shows which model omp uses for each role (`default`, `slow`, `plan`, `advisor`, `vision`, `smol`, `commit`, `tiny`, `task`) and the fallbacks that omp tries after that model, in order.
  A role without its own chain says that it uses the `default` role's chain.
  Chains keyed by a model or a `provider/*` wildcard appear in their own table, and the `modelProviderOrder` follows.
  **Retry and fallback**, last on the page, lists the `retry.*` settings with omp's defaults filled in, for example `usageAwareFallback`, `usageReservePct`, and `usageReservePolicy`.
  Hover a retry setting to see its config key.
- Every part of the routing has an **Edit** button.
  On a role, pick its model and thinking level from the models that `omp models` lists, then add, remove, or reorder its fallbacks.
  Save writes the change to your `~/.omp/agent/config.yml` and leaves every other key as it was.
  A role that walks the `default` chain keeps doing so until you change its fallbacks.
  Removing every fallback of a role removes its own chain, so it walks the `default` chain again.
  The retry settings and the provider order save the same way.
  A workspace's `.omp/config.yml` still overrides what you save there.
- **Model profiles**, first on the Models page, are named snapshots of your routing: each role's model with its thinking level, the fallback chains, and the provider order.
  **Save current as…** names one from what your `~/.omp/agent/config.yml` routes now, and saving under a name already used replaces that profile.
  Click a profile to write its routing to `config.yml` in one step; every other key stays as it was.
  The profile that matches `config.yml` shows as active, whether you applied it or edited the routing back to it.
  Running sessions keep their model, and new sessions use the profile.
  **Delete** beside a profile reads **Confirm delete?** after the first click, and a second click deletes it.
  A profile leaves out the other `retry.*` settings and agent model overrides, and a workspace's `.omp/config.yml` still overrides it.
  The dashboard keeps profiles in `model-profiles.json` beside its access token, apart from omp's own `/modelpreset` presets.
- **Agents** previews the agents a new session in this workspace discovers, alphabetically, with their descriptions, scopes, read-only classification, and effective models.
  With **All workspaces**, the preview includes user and bundled definitions and user plugins, not project or session-local agents.
  Search by name, description, scope, source path, tools, or model; Escape clears the search and leaves the field.
  Expanding a row shows its source, declared tools, definition model choices, user override, and workspace override.
  **Edit** under **User model override** picks a model or model role, with an optional thinking level; **Use ordered model choices** lets omp try selectors in order.
  Save changes only that agent's entry in your `config.yml`; **Clear user override**, confirmed and then saved, removes the entry rather than writing the definition back.
  Unknown selectors and role aliases already saved stay unchanged unless you edit them.
  A workspace override keeps winning and links to **Files**; user defaults apply in other workspaces and to later spawns, never to subagents already running.
  Bundled seance chooses its model from the source session or invocation, so only a stale saved override can be cleared.
  **Overrides for missing agents** lists saved entries with no discovered definition and lets you clear them.
  **Execution settings** uses omp's labels and descriptions for the concurrency limit, whether tasks may request a separate checkout, whether successful changes apply back, and the apply method; zero concurrency means unlimited.
  Each execution row uses **Edit**, **Save**, and **Cancel**, with the same control and layer notes as **omp settings**.
  A dot marks a value different from omp's default, and a lock marks a workspace value; user edits still apply in other workspaces.
  The apply controls hide while isolation is off without deleting their saved values.
  Switching sections, folding a row, and searching keep unsaved edits; changing workspace starts a separate editor.
  **Refresh** reads discovery again, and a failed refresh keeps the last preview but prevents saving until another refresh succeeds.
  This is not a live-session catalog; running sessions may have extension-provided agents or different model choices.
- **omp settings** lists omp's own settings in the tabs and groups of omp's `/settings` panel, from **Appearance** to **Providers**, with how many settings in each tab differ from omp's default.
  Settings that change only how omp's terminal draws, such as the theme, the status line, and the editor, are left out, since sessions the dashboard starts have no terminal.
  The field above the tabs finds settings in every tab by name, config key, description, or current value; tabs with no match dim, and selecting a tab clears the search.
  Each setting has the control omp's panel gives it: a switch, a menu of omp's choices, a text field saved on Enter or when you leave it, JSON text for a list or a map, an ordered list, or a request limit per provider.
  When omp describes the choice picked in a menu, the description shows under the setting's own.
  A change saves at once to your `~/.omp/agent/config.yml` and leaves every other key as it was; a dot after a setting's name marks a value other than omp's default, and hovering it names the default.
  **Reset** removes your value from `config.yml`, so the setting goes back to the workspace's value or omp's default.
  Clearing a text field resets it too; Escape puts the field back as it was.
  A key, token, or password never reaches the page: its field says only whether it is set, and typing replaces it.
  When the workspace's own settings set a value, the control is locked, and the row links to that file in **Files** and shows your value; your saved value applies in other workspaces.
  When an environment variable sets a value, the row names the variable, which overrides what you save.
  The settings **Models**, **Agents**, and **Storage** edit show as lines linking to those sections instead of a second editor.
  Settings omp gives no control to are counted under the tabs, with a link that opens `config.yml` in **Files**.
  One of them gets a row here anyway: **Speech-to-Text Language**, in **Interaction › Speech**, picks the language you dictate in, such as French.
  Whisper and cloud models transcribe in that language; Parakeet, omp's default local model, recognizes the language on its own.
  If `config.yml` changed on disk since the page read it, the save is refused and the page reloads the setting.
  Running sessions pick up most changes; some apply only to sessions started after the change.
- **omp memory** shows what omp itself remembers across sessions in the workspace, and the settings that decide it.
  The bar at its top holds omp's own rows for the memory backend, **Off**, **Local**, **Hindsight**, **Mnemopi**, or **Sharpshooter**, with omp's description of the one picked, and for Auto-learn, which nudges the agent to capture lessons and skills when it stops; with Auto-learn on, a second switch runs one capture turn then, which uses extra tokens.
  They show omp's labels and save to your `~/.omp/agent/config.yml` as in **omp settings**, which shows them as a line that links here; a value the workspace's settings set locks its control, and an environment variable that sets one is named under it.
  **What a new session gets** unfolds the memory block a new session's prompt starts with, and its size in tokens; with Mnemopi and Hindsight a running session also gets memories recalled for each prompt, which the page cannot show.
  **Stored memory** shows the store of the backend picked.
  Local lists its files in a folder per group, **Lessons**, **Summary**, **Skills**, and **Session summaries**, and Sharpshooter its decision files in **Decisions**, with how many sessions wait to be folded in; folders work as in **Files**, and you select a file to read it and edit it as in **Files**.
  Mnemopi lists its memories newest first, up to 500, with a filter and a count of each kind: **Edit** changes a working memory's text, saved with **Save** or Cmd+Enter, where Enter starts a new line, and put back with Escape, **Forget** deletes it, **Retire** stops recall from using an episodic one, and facts are read-only.
  Hindsight lists the memories its server keeps for the workspace's bank, read-only.
  **Forget everything**, beside the **Stored memory** heading, deletes the workspace's Local, Sharpshooter, or Mnemopi store, and the line under the heading says what it removes; with Mnemopi it keeps the bank every workspace shares, and a memory of that bank changes everywhere when you edit or forget it.
  **Rebuild summary**, with Local, rebuilds the summary when the next session in the workspace starts.
  **Forget**, **Retire**, and **Forget everything** each ask you to click again to confirm, and an edit made elsewhere since the page read it is refused and the page shows the memory as it is now.
  Running sessions keep the memory they started with; new sessions see your changes.
- The **Files** section lists the files that omp reads as folders, by where they sit on disk: context files such as `AGENTS.md`, the `SYSTEM.md` and `APPEND_SYSTEM.md` prompt files, `config.yml`, agents, commands, rules, skills, and hooks.
  The list starts inside the folder that holds every file, such as `~`. A skill shows as its directory's name in its `skills` folder, with the first two lines of its frontmatter's `description` under it, and a folder holding only one folder joins it, such as `.omp/agent`.
  Folders start closed except those holding the open file, and opening a file from another section opens its folders.
  The field above the list narrows it to the files whose name holds every word typed and opens every folder; Escape clears it.
  Select a file to read it: Markdown renders as the agent's messages do, under its frontmatter's keys and values, and **Source** next to **Preview** shows its text; any other file shows as numbered lines that wrap, colored by its type.
  Choose **Edit** to change the file in place (**Create** for a file marked `missing`).
  Save with the button or with Cmd+S. If the file changed on disk after the page read it, the save is refused and your edits stay in the editor, so you can copy them before you load the file from disk.
  A `.yml`, `.yaml`, or `.json` file must parse before it saves, and a settings file must hold a mapping.
  `~/.omp/agent/AGENTS.md` and `~/.omp/agent/config.yml` appear even before they exist, marked `missing`.
  If omp cannot load `config.yml`, **Models**, **Agents**, and **omp settings** show omp's error and **Files** still lists the files, so you can fix the broken file there.
  Files from installed plugins and omp's bundled rules are left out.
- **Extensions** manages packages, contribution previews, cached marketplace catalogs, the skill registry, and discovery sources; see [Extensions](extensions.md).
- The **Workflows** section lists your workflows: skills whose `SKILL.md` frontmatter tags them `workflow`, such as the starter kit's `ship` skill, which holds the steps `/ship` follows.
  Each shows its name, how to start it, `/<name>` when a command of the same name exists and `/skill:<name>` otherwise, and whether it is a user or a project skill.
  Select one to read its `SKILL.md`, and choose **Edit** to change an authored workflow in place, with the same save and conflict rules as **Files**; packaged workflows are read-only and link to Extensions.
  Above it, a diagram shows the workflow: the first `mermaid` block in its `SKILL.md`, such as the `ship` skill's stages with their skips and the live review loop, or, without one, its numbered `1. **Step.**` items in a straight line.
  To make a skill a workflow, add `tags: workflow` under `metadata:` in its frontmatter; `tags` takes a comma-separated list, such as `review, workflow`, and a top-level `tags:` key does not count.
  With none tagged, the section shows those two lines to copy.
- The **Decisions** section shows the decision records of the workspace's repository as a timeline, newest first, under a month header that stays at the top while you scroll: each record's date, status, title, and first paragraph, with **Read the record** to open the whole of it.
  Records are the files the starter kit's `decision-records` skill writes in `docs/decisions/`; a repository that keeps them in an ADR directory, docs/adr or doc/adr, shows those instead.
  **In force** hides superseded, deprecated, and rejected records, and **All** shows them, struck through; **Search** narrows the list by title, file name, status, or text.
  A record's **Supersedes** and **Superseded by** open and scroll to the records they name, and a link to another file in the repository opens it in the file dialog.
  The section only reads the records, since a record changes in the same commit as the code it covers.
  With **All workspaces**, the same timeline is grouped by workspace, one section per repository that keeps records, and a record's links stay inside its own repository. A workspace with no records is left out of the list.
- **Preferences** holds the dashboard's own choices, saved in the app, not in omp's files.
  The server keeps them too, so every window you open shows the same, and **Sync** carries them to your other machines; **Stop idle processes** is the server's own and stays on this machine.
  The width of a sidebar or a split, a folded section, and what you last picked in a menu stay with the browser that set them.
  **Theme**: **System** follows the computer's light or dark setting, and **Light** and **Dark** pin one; it applies at once and does not change omp's terminal theme.
  **Transcript**: **Show tool calls** and **Show thinking** are the same choices as their shortcuts.
  **Sidebar tabs** lists the nine sidebar tabs in the order they show, each with a switch that shows or hides it, and buttons that move it up or down.
  A hidden tab only leaves the sidebar's page list: its page, its command in the command menu, its G pair, and links to it still work.
  While omp holds no sign-in to Linear or Gmail, the **Tickets** or **Email** row says that tab shows only once the service is connected.
  Putting every tab back in its default order and shown forgets the choice, so the sidebar follows the default again.
  **Notifications** turns the [session notifications](notifications.md#session-notifications) on or off, picks whether finished turns notify too, and picks their sound and whether it plays while the window is focused.
  **Stop idle processes** picks when the server stops the dev servers, watchers, and services that sessions start besides omp: **Off**, or after 15 minutes, 30 minutes, 1 hour, or 2 hours, 30 minutes by default.
  A process stops once every session it serves has been idle that long; see [Sessions sidebar](sessions-sidebar.md).
  The server keeps the choice in `processes.json` beside its access token, so it applies with no page open.
  **New sessions** pins a skill.
  Every session that you start from the dashboard, from the new-session draft or from a quick action on a pull request, a Linear issue, or a todo, then sends its first message through that skill.
  The picker lists the skills of the sidebar's workspace, and says which, or your own skills with **All workspaces**.
  Choose **None** to unpin.
- **Keyboard** lists every keyboard shortcut by category, and `?` outside a text field opens it; see [Keyboard shortcuts](keyboard-shortcuts.md).
- **Providers** signs omp in to the model providers its sessions call, as `/login` and `omp login` do; see [Providers](providers.md).
- **Integrations** connects omp to Linear and Slack and the dashboard to Google Calendar and Gmail; see [Integrations](integrations.md).
- **MCP servers** lists every MCP server omp loads and adds more from a catalog or by address; see [MCP servers](mcp-servers.md).
- **Source control** shows whether the `gh` command-line tool is installed and signed in, under **Command-line tools**; **Check again** reads it again.
  **Automatically pull** keeps the default branch current when the checkout has no local changes or commits; it is off by default, and the server checks every five minutes and right after a change.
  Each repository your workspaces use lists its last pull and an override, **Default**, **On**, or **Off**; the server keeps both in `source-control.json` beside its access token.
  Repositories show their path from your home folder, and repositories in temporary folders are left out.
  **After a merge**, on by default and kept in the same file, ends each session the dashboard started that is linked to a pull request that merges, once the session is idle and every pull request it submitted or worked on is merged or closed, whether the merge came from the dashboard or anywhere else.
  It never ends an omp session you run in a terminal, nor one another dashboard started, and it leaves a worktree that any live session, a terminal one included, still works in.
  The dashboard sees a merge it made at once, and one made elsewhere within two minutes; a merge made before the dashboard started, or before the session linked the pull request, ends nothing.
  A session still working when its pull request merges, or waiting to continue after a usage limit or a connection error, ends once it is idle with no continue waiting; one whose other pull request closes later ends then, and one the dashboard could not end is tried again two minutes later.
  Ending it removes its linked worktree as **Archive session** does, so a worktree with changes stays, then deletes the local branch of the merged pull request, but only when the merge took every commit of the branch and no worktree has it checked out.
  **Default merge method** picks the method a pull request's merge button starts with; **Last selected** reuses the method of your last confirmed merge in the app, and a method the repository does not allow falls back to the first one it does.
- **Workspaces** lists the directories that the sidebar's workspace picker and the directory pickers offer.
  Type a path in **Directory** and choose **Add workspace** to offer a directory no session ran in yet; `~` works, and a path that is not a directory shows an error.
  In the desktop app, **Choose folder…** opens the system's folder picker and adds the folder you pick.
  **Hide** drops a workspace and its sessions from the pickers, the session lists and counts, and session search, as for `/tmp`; a direct session link still opens them.
  Hidden workspaces list under **Hidden**, and **Show** offers one again.
  The server keeps the list in `workspaces.json` beside its access token, so every window of the app shows the same workspaces.
  **Trusted projects** lists the projects whose own agent code you trusted, with **Stop trusting** to ask again; see [Per-project agent setup](per-project-agent-setup.md#stop-trusting).
- **Sync** carries your omp settings and files to your other machines through a Git repository of yours; see [Settings sync](settings-sync.md).
- **Phone access** serves the dashboard to your phone through Tailscale and pairs phones with a one-time code; see [Phone access](phone-access.md).
  A paired phone does not list the section.
- Settings follows the workspace picked in the sidebar header, so it includes that workspace's project files and its `.omp/config.yml` overrides.
  With no workspace picked, which the header's picker reads as **All workspaces**, **Models**, **Agents**, **omp settings**, **Files**, **Extensions**, **Workflows**, and the **New sessions** skill picker show user files and packages only, **omp memory** shows only its settings, and **Worktrees** lists every repository.
  The picker in the header of a Workspace section is the same choice: picking a workspace there switches the sidebar to it too.
  Pressing the gear button while Settings is open closes it, so pick a section from the sidebar to change sections.
  A session's **Workspace settings** switches the sidebar to that session's workspace and opens **Models**; a session in `/tmp` or a hidden workspace does not offer it.
  The page is in the URL hash, `#settings/<section>`, such as `#settings/integrations`; `#settings` opens **Analytics**.
  After each save the page shows the settings as omp loads them from disk.
