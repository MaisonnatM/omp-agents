# Settings

- **Settings** is the last sidebar tab by default, after **Calendar** and, once Gmail is connected, **Inbox**.
  It stays selected while Settings is open, including through a session's **Workspace settings** menu item, a direct link, or the Settings shortcut.
  Select **Sessions** to return to the existing panes.
  The sidebar lists eleven sections in two groups.
  **General** holds **Analytics**, **Preferences**, **Providers**, **Integrations**, **MCP servers**, **Source control providers**, **Workspaces**, and **Sync**, which are the same whatever the workspace.
  **This workspace** holds **Models**, **Files**, and **Worktrees**, which show omp's config and files as a session in the sidebar's workspace loads them; only these sections show the workspace picker.
  It opens on **Analytics**, and the header names the open section.
  Switching sections keeps an unsaved edit and opens the new section at its top, and the selected section stays when you change workspace.
- **Analytics** shows request usage for the last 24 hours.
  Choose **Today**, **24h**, **7d**, **30d**, **90d**, or **All** to change the range; **Today** starts at local midnight.
  Each range's last result is cached in your browser, so switching back, reopening the page, or reloading shows it while a fresh read runs.
  A failed refresh keeps the cached result and shows the error.
  Refreshes run only while **Analytics** is open, every two seconds during indexing and every 30 seconds otherwise.
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
- **Worktrees** lists every Git worktree in repositories where a session ran, and a path you enter lists that repository too.
  A session directory that is gone or outside Git is skipped; a path you enter that is not in a repository says so.
  Each row shows the branch, the path below the repository's parent folder with the full path on hover, the last time an omp session file in that checkout changed, the last commit, approximate disk use, and tracked or untracked changes.
  No omp session reads as no omp session, not as unused.
  The status column stays empty for a checkout you can delete and names what blocks one you cannot; each repository's header checkbox selects every deletable row.
  **Delete** asks before it removes a linked worktree or forgets a registration whose directory is already gone.
  It keeps the branch and session transcripts.
  It refuses the main checkout, a locked checkout, unsaved changes, a nested repository, a checkout this dashboard or a live session is using, and a checkout whose subagent locations are unknown.
  Ignored files such as dependencies and `.env` are deleted with the checkout, and the confirmation names them.
  A detached commit that no branch contains is named before its registration can be removed.
  The page cannot see every shell or editor, so close other tools using a checkout before you delete it.
  Disk use is approximate, and removing a checkout may free less than the number shown.
  A row whose work has merged says **Merged** after its branch, with the pull request's number when GitHub's newest pull request from that branch merged.
  A worktree counts as merged when `origin`'s default branch contains its commit, which also covers a detached checkout, or when its branch's newest pull request merged and the branch has no commit made after the merge, which covers squash merges such as Graphite's.
  The main checkout is never flagged, and a repository GitHub cannot answer for says so above the list, while the default branch still flags what it contains.
  **Remove merged** previews every merged row the search shows and lists the ones it will remove and the ones it keeps, each with the reason.
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
  Select a file to read its content, and choose **Edit** to change it in place (**Create** for a file marked `missing`).
  Save with the button or with Cmd+S. If the file changed on disk after the page read it, the save is refused and your edits stay in the editor, so you can copy them before you load the file from disk.
  A `.yml`, `.yaml`, or `.json` file must parse before it saves, and a settings file must hold a mapping.
  `~/.omp/agent/AGENTS.md` and `~/.omp/agent/config.yml` appear even before they exist, marked `missing`.
  If omp cannot load `config.yml`, **Models** shows omp's error and **Files** still lists the files, so you can fix the broken file there.
  Files from installed plugins and omp's bundled rules are left out.
- **Preferences** holds the dashboard's own choices, saved in the browser's localStorage, not in omp's files.
  **Theme**: **System** follows the computer's light or dark setting, and **Light** and **Dark** pin one; it applies at once and does not change omp's terminal theme.
  **Transcript**: **Show tool calls** and **Show thinking** are the same choices as their shortcuts.
  **Sidebar tabs** lists the seven sidebar tabs in the order the sidebar shows them, each with the Cmd+number it takes now, a switch that shows or hides it, and buttons that move it up or down.
  A hidden tab only leaves the sidebar and loses its number: its page, its command in the command menu, its G pair, and links to it still work.
  **Settings** cannot be hidden, so you can always come back to show the others, but it can move.
  While omp holds no sign-in to Linear or Gmail, the **Tickets** or **Inbox** row says that tab shows only once the service is connected.
  Putting every tab back in its default order and shown forgets the choice, so the sidebar follows the default again.
  **Notifications** turns the [session notifications](notifications.md#session-notifications) on or off.
  **New sessions** pins a skill.
  Every session that you start from the dashboard, from the new-session draft or from a quick action on a pull request, a Linear issue, or a todo, then sends its first message through that skill.
  The picker lists the skills of the sidebar's workspace, and says which, or your own skills with **All workspaces**.
  Choose **None** to unpin.
- **Providers** signs omp in to the model providers its sessions call, as `/login` and `omp login` do; see [Providers](providers.md).
- **Integrations** connects omp to Linear and Slack and the dashboard to Google Calendar and Gmail; see [Integrations](integrations.md).
- **MCP servers** lists every MCP server omp loads and adds more from a catalog or by address; see [MCP servers](mcp-servers.md).
- **Source control providers** shows whether the `gh` and `gt` command-line tools are installed and signed in; **Check again** reads them again.
  **Automatically pull** keeps the default branch current when the checkout has no local changes or commits; it is off by default, and the server checks every five minutes and right after a change.
  Each repository your workspaces use lists its last pull and an override, **Default**, **On**, or **Off**; the server keeps both in `source-control.json` beside its access token.
  **After a merge**, on by default and kept in the same file, ends each session the dashboard started that is linked to a pull request that merges, once the session is idle and every pull request it submitted or worked on is merged or closed, whether the merge came from the dashboard or anywhere else.
  It never ends an omp session you run in a terminal, nor one another dashboard started, and it leaves a worktree that any live session, a terminal one included, still works in.
  The dashboard sees a merge it made at once, and one made elsewhere within two minutes; a merge made before the dashboard started, or before the session linked the pull request, ends nothing.
  A session still working when its pull request merges, or waiting to continue after a usage limit or a connection error, ends once it is idle with no continue waiting; one whose other pull request closes later ends then, and one the dashboard could not end is tried again two minutes later.
  Ending it removes its linked worktree as **End session** does, so a worktree with changes stays, then deletes the local branch of the merged pull request, but only when the merge took every commit of the branch and no worktree has it checked out.
  A project's workers follow their project's **Workers' pull requests** instead, and a coordinator never ends.
  **Default merge method** picks the method a pull request's merge button starts with; **Last selected** reuses the method of your last confirmed merge in this browser, and a method the repository does not allow falls back to the first one it does.
- **Workspaces** lists the directories that the sidebar's workspace picker and the directory pickers offer.
  Type a path in **Directory** and choose **Add workspace** to offer a directory no session ran in yet; `~` works, and a path that is not a directory shows an error.
  **Hide** drops a workspace and its sessions from the pickers, the session lists and counts, and session search, as for `/tmp`; a direct session link still opens them.
  Hidden workspaces list under **Hidden**, and **Show** offers one again.
  The server keeps the list in `workspaces.json` beside its access token, so every browser tab and the desktop app show the same workspaces.
- **Sync** carries your omp settings and files to your other machines through a Git repository of yours; see [Settings sync](settings-sync.md).
- Settings follows the workspace picked in the sidebar header, so it includes that workspace's project files and its `.omp/config.yml` overrides.
  With **All workspaces**, **Models**, **Files**, and the **New sessions** skill picker show your user files only, and **Worktrees** lists every repository.
  The picker in the header of a Workspace section is the same choice: picking a workspace there switches the sidebar to it too.
  Selecting the active **Settings** sidebar tab keeps the section.
  A session's **Workspace settings** switches the sidebar to that session's workspace and opens **Models**; a session in `/tmp` or a hidden workspace does not offer it.
  The page is in the URL hash, `#settings/<section>`, such as `#settings/integrations`; `#settings` opens **Analytics**.
  After each save the page shows the settings as omp loads them from disk.
