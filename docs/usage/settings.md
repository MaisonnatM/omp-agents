# Settings

- The gear button at the right end of the header, after the notifications bell, opens **Settings**; G then , does the same.
  It stays pressed while Settings is open, including through a session's **Workspace settings** menu item or a direct link, and pressing it again, or G then ,, returns to the panes.
  While Settings is open the sidebar lists its sections below the tab bar, with no tab selected, in place of a tab's content; select a tab, such as **Sessions**, to leave.
  The sidebar lists fourteen sections in four groups.
  **Usage** holds **Analytics** and **Activity**, **General** holds **Preferences**, **Workspaces**, and **Sync**, and **Connections** holds **Providers**, **Integrations**, **MCP servers**, and **Source control**; these are the same whatever the workspace.
  **This workspace** holds **Models**, **Files**, **Workflows**, **Decisions**, and **Worktrees**, which show omp's config and files, and the repository's records and worktrees, as a session in the sidebar's workspace sees them; only these sections show the workspace picker.
  The command menu finds a section by its name or by what it holds, such as "theme" or "graphite", under **Settings**.
  The gear button and G then , reopen the section you last had open in this app, **Analytics** the first time, and the header names the open section.
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
  Tokens come from omp's tokenizer for each model, or about four characters a token for a model omp has none for.
  The report reads every session file once, then only the files that changed, and shows how far it has read while it catches up.
- **Activity** shows how you use the dashboard over the last 30 days; choose **Today**, **24h**, **7d**, **30d**, **90d**, or **All** to change the range.
  It counts the pages and settings sections you open, the shortcuts and command palette commands you run, the changes you send, and clicks on a few controls that change nothing else, by name only, never what they show or what you typed.
  **Not used** lists every feature with no use in the range and when you last used it, or **Never**; features used once or twice follow.
  The pages, commands, and changes of a service omp is not signed in to, such as **Email** and its commands without Gmail, are listed apart and not counted.
  **Most used** lists the top 20 features, with how many days you used each and, for a command, how often you ran it by its keys and from the palette.
  **Navigation** lists the 15 most common moves from one view to another and the time spent on each view.
  **Active time** charts the minutes you used the dashboard each day, up to five minutes between two uses, with a table of each day's active time, visits, and changes sent.
  Only the server that runs the unattended work keeps activity, in `activity.db` in its data directory; a browser under automation records nothing.
- **Worktrees** lists every Git worktree in repositories where a session ran; **Show another repository**, below the list, lists one more.
  A session directory that is gone or outside Git is skipped; a path you enter that is not in a repository says so.
  Above the list, the tab counts the worktrees, their disk use measured so far, and the merged ones with their size; **All**, **Merged**, and **Removable** filter the rows.
  Each row shows the branch, the path below the repository's parent folder with the full path on hover, the last time an omp session file in that checkout changed, the last commit, approximate disk use, and tracked or untracked changes.
  No omp session reads as no omp session, not as unused.
  Rows keep their order while sizes are measured and sort again once every size is in or you change the sort.
  A badge after the branch names what blocks deleting a checkout, with the full reason on hover; each repository's header checkbox selects every deletable row.
  Selected rows show a bar at the bottom of the page with their count, size, **Clear**, and **Delete**.
  **Delete** asks before it removes a linked worktree or forgets a registration whose directory is already gone.
  It keeps the branch and session transcripts.
  It refuses the main checkout, a locked checkout, unsaved changes, a nested repository, and a checkout this dashboard, a live session, or a resident subagent uses.
  Subagent blockers name the session and subagent. Known default and Bash working directories protect their containing checkouts, not unrelated siblings.
  Missing or incomplete subagent evidence and disconnected rosters keep repository-wide protection. If the repository is unknown too, every checkout stays protected.
  Ignored files such as dependencies and `.env` are deleted with the checkout, and the confirmation names them.
  A detached commit that no branch contains is named before its registration can be removed.
  The page cannot see every shell or editor, so close other tools using a checkout before you delete it.
  Disk use is approximate, and removing a checkout may free less than the number shown.
  A row whose work has merged says **Merged** after its branch, with the pull request's number when GitHub's newest pull request from that branch merged.
  A worktree counts as merged when `origin`'s default branch contains its commit, which also covers a detached checkout, or when its branch's newest pull request merged and the branch has no commit made after the merge, which covers squash merges such as Graphite's.
  The main checkout is never flagged, and repositories GitHub cannot answer for share one warning above the list, while the default branch still flags what it contains.
  **Remove merged** previews every merged row the search and filter show, says about how much disk it frees, and lists the ones it will remove and, folded, the ones it keeps, each with the reason.
  It keeps a worktree with unsaved changes, one a live session uses, one whose work it cannot show merged, and everything **Delete** refuses.
  Confirming removes only the worktrees it listed for removal, keeps their branches, and reports how many it removed, kept, and failed to remove.
  Nothing is removed until you confirm.
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
- The **Files** section lists the files that omp reads: context files such as `AGENTS.md`, the `SYSTEM.md` and `APPEND_SYSTEM.md` prompt files, `config.yml`, agents, commands, rules, skills, and hooks.
  The field above the list narrows it to the files whose name holds every word typed; Escape clears it.
  Select a file to read its content, and choose **Edit** to change it in place (**Create** for a file marked `missing`).
  Save with the button or with Cmd+S. If the file changed on disk after the page read it, the save is refused and your edits stay in the editor, so you can copy them before you load the file from disk.
  A `.yml`, `.yaml`, or `.json` file must parse before it saves, and a settings file must hold a mapping.
  `~/.omp/agent/AGENTS.md` and `~/.omp/agent/config.yml` appear even before they exist, marked `missing`.
  If omp cannot load `config.yml`, **Models** shows omp's error and **Files** still lists the files, so you can fix the broken file there.
  Files from installed plugins and omp's bundled rules are left out.
- The **Workflows** section lists your workflows: skills whose `SKILL.md` frontmatter tags them `workflow`, such as the starter kit's `ship` skill, which holds the steps `/ship` follows.
  Each shows its name, how to start it, `/<name>` when a command of the same name exists and `/skill:<name>` otherwise, and whether it is a user or a project skill.
  Select one to read its `SKILL.md`, and choose **Edit** to change it in place, with the same save and conflict rules as **Files**.
  To make a skill a workflow, add `tags: workflow` under `metadata:` in its frontmatter; `tags` takes a comma-separated list, such as `review, workflow`, and a top-level `tags:` key does not count.
  With none tagged, the section shows those two lines to copy.
- The **Decisions** section shows the decision records of the workspace's repository as a timeline, newest first, under a month header that stays at the top while you scroll: each record's date, status, title, and first paragraph, with **Read the record** to open the whole of it.
  Records are the files the starter kit's `decision-records` skill writes in `docs/decisions/`; a repository that keeps them in an ADR directory, docs/adr or doc/adr, shows those instead.
  **In force** hides superseded, deprecated, and rejected records, and **All** shows them, struck through; **Search** narrows the list by title, file name, status, or text.
  A record's **Supersedes** and **Superseded by** open and scroll to the records they name, and a link to another file in the repository opens it in the file dialog.
  The section only reads the records, since a record changes in the same commit as the code it covers; with **All workspaces** it asks you to pick one.
- **Preferences** holds the dashboard's own choices, saved in the app, not in omp's files.
  The server keeps them too, so every window you open shows the same, and **Sync** carries them to your other machines; **Stop idle processes** is the server's own and stays on this machine.
  The width of a sidebar or a split, a folded section, and what you last picked in a menu stay with the browser that set them.
  **Theme**: **System** follows the computer's light or dark setting, and **Light** and **Dark** pin one; it applies at once and does not change omp's terminal theme.
  **Transcript**: **Show tool calls** and **Show thinking** are the same choices as their shortcuts, and **Show todos card** shows or hides the agent's todo list in the Todos card beside or above the messages of every transcript; the card's **Files**, **Images**, and **Sources** sections stay.
  **Sidebar tabs** lists the eight sidebar tabs in the order they show, each with the Cmd+number it takes, a switch that shows or hides it, and buttons that move it up or down.
  **Notes**, **Calendar**, and **Email** say **Header**: they sit in the header beside the command menu and take no number, and Cmd+1 goes to the first tab the sidebar's bar draws.
  A hidden tab only leaves the sidebar's bar or the header and loses its number: its page, its command in the command menu, its G pair, and links to it still work.
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
- **Providers** signs omp in to the model providers its sessions call, as `/login` and `omp login` do; see [Providers](providers.md).
- **Integrations** connects omp to Linear and Slack and the dashboard to Google Calendar and Gmail; see [Integrations](integrations.md).
- **MCP servers** lists every MCP server omp loads and adds more from a catalog or by address; see [MCP servers](mcp-servers.md).
- **Source control** shows whether the `gh` and `gt` command-line tools are installed and signed in, under **Command-line tools**; **Check again** reads them again.
  While Graphite is signed out, paste a token from **Get a token** and choose **Sign in**, which runs `gt auth` for you.
  **Automatically pull** keeps the default branch current when the checkout has no local changes or commits; it is off by default, and the server checks every five minutes and right after a change.
  Each repository your workspaces use lists its last pull and an override, **Default**, **On**, or **Off**; the server keeps both in `source-control.json` beside its access token.
  Repositories show their path from your home folder, and repositories in temporary folders are left out.
  **After a merge**, on by default and kept in the same file, ends each session the dashboard started that is linked to a pull request that merges, once the session is idle and every pull request it submitted or worked on is merged or closed, whether the merge came from the dashboard or anywhere else.
  It never ends an omp session you run in a terminal, nor one another dashboard started, and it leaves a worktree that any live session, a terminal one included, still works in.
  The dashboard sees a merge it made at once, and one made elsewhere within two minutes; a merge made before the dashboard started, or before the session linked the pull request, ends nothing.
  A session still working when its pull request merges, or waiting to continue after a usage limit or a connection error, ends once it is idle with no continue waiting; one whose other pull request closes later ends then, and one the dashboard could not end is tried again two minutes later.
  Ending it removes its linked worktree as **End session** does, so a worktree with changes stays, then deletes the local branch of the merged pull request, but only when the merge took every commit of the branch and no worktree has it checked out.
  **Default merge method** picks the method a pull request's merge button starts with; **Last selected** reuses the method of your last confirmed merge in the app, and a method the repository does not allow falls back to the first one it does.
- **Workspaces** lists the directories that the sidebar's workspace picker and the directory pickers offer.
  Type a path in **Directory** and choose **Add workspace** to offer a directory no session ran in yet; `~` works, and a path that is not a directory shows an error.
  In the desktop app, **Choose folder…** opens the system's folder picker and adds the folder you pick.
  **Hide** drops a workspace and its sessions from the pickers, the session lists and counts, and session search, as for `/tmp`; a direct session link still opens them.
  Hidden workspaces list under **Hidden**, and **Show** offers one again.
  The server keeps the list in `workspaces.json` beside its access token, so every window of the app shows the same workspaces.
- **Sync** carries your omp settings and files to your other machines through a Git repository of yours; see [Settings sync](settings-sync.md).
- Settings follows the workspace picked in the sidebar header, so it includes that workspace's project files and its `.omp/config.yml` overrides.
  With **All workspaces**, **Models**, **Files**, **Workflows**, and the **New sessions** skill picker show your user files only, and **Worktrees** lists every repository.
  The picker in the header of a Workspace section is the same choice: picking a workspace there switches the sidebar to it too.
  Pressing the gear button while Settings is open closes it, so pick a section from the sidebar to change sections.
  A session's **Workspace settings** switches the sidebar to that session's workspace and opens **Models**; a session in `/tmp` or a hidden workspace does not offer it.
  The page is in the URL hash, `#settings/<section>`, such as `#settings/integrations`; `#settings` opens **Analytics**.
  After each save the page shows the settings as omp loads them from disk.
