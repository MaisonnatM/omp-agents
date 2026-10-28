# Conversations

- Opening a live session or subagent puts the cursor in the focused pane's composer once it accepts messages, so you can type right away.
  A session that reconnects takes the cursor back the same way.
- The road icon right after a session's title in a pane's header switches the pane between the transcript and **Trajectory**; a live session keeps its composer under either.
  **Trajectory** is a ledger of the conversation's turns, one row per prompt you or a skill sent, with a row first for what came before your first prompt.
  Its columns are the prompt's first line with its skill, the turn's model requests and tool calls, its input, output, cache-read, and cache-write tokens, and its cost, underlined by the turn's share of the session's cost; a last row adds up every turn.
  Open a row for each step in order, its tokens in the same columns: what omp injected before or during the turn, such as a skill's body, a system reminder, or a rule, each named by its source; model and thinking-level changes; each model request with its model, time, and stop reason; the thinking and the reply; each tool call with its result size and time; side calls such as auto-thinking; and compactions.
  A turn's tokens add up its requests and its side calls, each from the usage omp recorded for it.
  A subagent's turns show in the subagent's own pane, not its parent's.
  The pane goes back to the transcript when it opens another conversation.
- The transcript fades at its top or bottom edge only while more of it lies past that edge, so a conversation that fits the pane shows no fade.
- Each tool call in a tool group is a line with an icon for its tool, such as a terminal for `bash`, a page for `read`, and a plug for an MCP tool; a tool without its own icon shows a wrench.
  A call that is running shimmers, a call that failed is red, and the group's heading counts the failures.
- The model's thinking is a line in that same group, **Thinking** while the model still writes it and **Thought** after, with its text under it; click the line to fold the text.
  A thinking block the provider redacts, which has no text, stays out.
  **Settings → Preferences** has a switch for each, **Show tool calls** and **Show thinking**, which hides the tool rows or the thinking text in every pane; the heading stays.
  The choice is saved in the app.
  Cmd+Shift+E shows or hides the tool rows, and Alt+T (Option+T on macOS) shows or hides the thinking.
  Cmd+E still opens or closes the group.
- A `task` tool call lists the subagents it spawned, by id, under its row: each one as it starts while the call runs, and every one once the call finishes.
  A tool group that spawned subagents stays open.
  In a live session or subagent, each id is a link with the subagent's status dot (none while running, blue idle, hollow parked, red aborted); hover it for the subagent's type, status, and what it is doing.
  Click it to open the subagent, Cmd-click (Ctrl-click on Linux and Windows) to open it in a split, or middle-click to open it in the app window in place of what it shows.
  A subagent's own `task` calls link its subagents the same way.
  A past session's ids are not links, because the dashboard opens subagents only of a running session.
- A tool call whose result returned images, such as a browser screenshot or a `read` of an image file, shows them as thumbnails under its row; click one to open it large, with the tool and what the call said it did.
  The arrows, or the Left and Right keys, step to the previous and next tool image of the conversation, across calls, and the external-link button opens the image in your default browser.
  A tool group that returned images stays open.
  Hiding tool calls hides them too; the Todos card's **Images** section still lists every one.
- A code block in a message names its language above the code, colors it, and has a copy button; a block with no language shows the button when you hover or focus it.
- In a session's conversation, a `mermaid` or `chart` code block in a message draws as a diagram or a chart once the message settles; while a reply streams, it shows as code.
  A `mermaid` block draws a flowchart (`graph` or `flowchart` with a direction such as `TD` or `LR`), a `sequenceDiagram`, a `stateDiagram-v2`, a `classDiagram`, or an `erDiagram`, named on its first line, in up to 20,000 characters.
  A `chart` block holds one JSON object: `{"type": "bar" | "line" | "area" | "pie", "title"?, "description"?, "x", "series": [{"key", "label"?}], "data": [...]}`.
  Each row holds the `x` key, text or a number, and each series key, a finite number, and nothing else; a chart has 1 to 5 series and 1 to 500 rows, and a pie exactly one series, whose `x` names each slice.
  The block's header switches between **Preview** and **Source**, copies the block's exact text, and expands the visual into a dialog for a narrow pane.
  A block that breaks these rules, such as a pie or gantt diagram, an unknown key, or a value that is not a number, shows its text with a note that says why.
  Each session the dashboard starts, resumes, or forks is told these two formats in its system prompt; a replay and a terminal session are not, so a replay's requests still match the original's.
- A subagent's header trail names the session's title and the subagent's id, then the subagent's type as a badge, as in `Fix login / 0-Explore` `explore`.
  Click the session's title to open the session's main agent in the pane, or focus the pane that already shows it.
- In a subagent of a terminal session, a message steers a running subagent, prompts an idle one, and revives a parked one.
  A follow-up (Ctrl+Enter, or Cmd+Enter on macOS) waits in the dashboard until the subagent stops running.
  In a subagent of a session that the dashboard started, a message steers a running subagent at its next step, through omp's RPC `steer_subagent`.
  omp's RPC mode reaches only a running subagent, so the composer offers no follow-up there and is disabled once the subagent stops.
  The composer is also disabled for aborted subagents and read-only rooms.
- The stop button after a running subagent's link cancels it, as the kill in omp's Agent Hub does, and leaves the session's own turn running.
  The subagent's task ends with an aborted result; since omp 18.12.3, a message or a revive in omp resumes it from its transcript, while the dashboard's composer stays disabled for it.
  It is offered in every room that the dashboard can write to.
- The conversation follows new output while you are at the bottom.
  Scrolling up pauses that follow; the down-arrow button jumps back to the latest message.
- A minimap on the conversation's left edge draws one short line per turn, once there are two, when the pane is wide enough to leave room beside the messages.
  Hovering a line grows it and, less, its neighbours, and opens a card with the turn's prompt and the first words of its reply, or **Working…** while it runs; a bold label that opens a reply, such as **Résumé**, is left out.
  Click a line to scroll the conversation to that prompt; the arrows above and below the lines, shown on hover, step to the previous and next turn.
  The line of the turn you are reading stays lit as you scroll; after a click it stays on that turn until you scroll yourself, since the last turns may never reach the top.
- The **Todos** card holds the agent's todo list and the **Files**, **Images**, and **Sources** sections of [Changed files and images](changed-files-and-images.md), each shown once it has something to list; a past session's conversation shows it too.
  Once the view's agent made a todo list, the card shows the list as its latest `todo` call left it: how many tasks are done of all, a thin progress line, and the task in progress.
  It floats at the conversation's top right, narrowing to fit the space beside the messages, and sits above them when that space is too narrow, so it never covers a message; it scrolls as a whole when its sections outgrow it.
  Click the todo summary to unfold every phase, and click it again to fold it; it starts folded, and the app remembers your choice for every conversation.
  **Show todos card** in Settings › Preferences hides the todo list and keeps the other sections.
  Unfolded, each phase shows its done count and its open tasks first, a blocked task's reason under it; its done and dropped tasks fold into an **N done** row.
  Each status has its own mark: an empty ring for to do, a spinning arc beside a shimmering title for in progress, a green disc with a check for done, an amber disc with an exclamation mark for blocked, and a dashed ring for dropped.
  A phase with every task done folds to one line; click it to open it.
  Task text shows its Markdown, such as code and bold.
  It follows the agent's calls while the turn runs, and a subagent's view shows that subagent's own list.
  This list is the agent's own and is separate from your Todo page.
- The clock button in the composer, shown once a session has two prompts, opens **Chat history**: it blurs the conversation and gathers every prompt you sent into one column over it, newest at the bottom.
  Prompts that were in view slide from their place into the column.
  Click a prompt to close the history, scroll the conversation to it, and briefly outline its bubble; the X in the button's place, Escape, or a click on the blur closes it where you were.
- In a session the dashboard started, a prompt sent to an idle session shows at once, dimmed, at the end of the conversation, and the session shows as working.
  That covers a new session's first message, a suggested prompt, and an edited prompt.
  omp takes up to a few seconds before its turn starts, and the prompt shows in full once it does.
  A prompt that ends without a turn, such as one a usage limit refuses, takes the dimmed prompt away.
  Stop before its turn starts takes it away too and puts it back in the composer, with its images.
  omp's own `/` commands, such as `/model` or `/rename`, show no dimmed prompt; a `/skill:` prompt does.
- User and assistant messages render GitHub-flavored Markdown, including tables, task lists, fenced code, and links.
  Images in agent text show as links rather than loading remote images; only inline `data:` images show in place.
  Linear, GitHub, Graphite, and Slack links show only their title and service icon, in conversations and rendered GitHub or Linear text.
  Bare GitHub and Graphite pull request URLs resolve to the PR's actual title through your signed-in GitHub CLI.
  Explicit Markdown labels and link titles stay as written.
  While a PR title loads, or if GitHub cannot read it, its repository and number stay visible; other bare service links use an issue identifier or **Slack message**.
  The link still opens its original address in your default browser.
  Other HTTP and HTTPS links keep their original label, with no icon.
  Link labels are semibold (font weight 600) and underlined beside their icons, without underlining the icons.
  A link loads nothing before you click it: a favicon fetched from the link's host, or from a favicon service, would send that hostname out the moment the text rendered, and a prompt-injected agent can write a secret into a hostname.
- A path to a text file in agent text opens the file in a dialog: `.md`, `.markdown`, `.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.xml`, `.diff`, or `.patch`.
  An absolute or `~/` path opens from plain text, inline code, or a link, `file://` included; a relative one opens from inline code or a link, against the linked worktree the session works in, else the session's directory.
  A `:line` suffix, as in `docs/usage.md:12`, is dropped; hover the path to read the file it opens.
  Markdown renders as the agent's messages do, a TSV or CSV file as a table of its first 1,000 rows, and anything else as plain text; **Show source** shows a rendered file's text.
  A path in an open Markdown file opens in the dialog's place, relative to that file.
  The dialog shows the first 1 MB of a larger file and says so; it refuses a file whose real path, past any link, has another extension, and a file that is not UTF-8.
  A todo's notes do not open paths: a path there is plain text.
- An image or video on this computer that a prompt or the agent's text names shows in the message: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.mp4`, `.m4v`, `.webm`, or `.mov`.
  Its path is found as a text file's is, and opens the file dialog with the image large or the video playing.
  Written as an image, `![alt](path)`, it shows in place, and a video there plays in place; otherwise each one the text names shows once as a thumbnail under the text, a video by its first frame, and opens the dialog on click.
  A remote image, `![](https://…)`, stays a link, so a prompt-injected address never loads.
  A path to a missing file, or to one in a directory that does not open, shows no thumbnail.
- Every prompt has a copy button.
  Among the agent's messages, only the reply that ends each turn has one, not the messages it writes between tool calls.
  A turn still running shows none until it ends.
- A prompt that invoked a skill shows the skill as a chip with its name (`/skill:poteto-mode do X` reads **Poteto Mode** then `do X`), not the skill's text that omp sends the model.
  That covers skills sent from the dashboard, from omp's terminal, and to a subagent, in live and past sessions.
  Copy copies the prompt as typed.
  File commands show their expanded text, because omp records only that.
- A prompt's references show as chips, as the composer drew them: a leading `/command`, `@` files and folders, and the todos, tickets, pull requests, and sessions the `@` menu inserted.
  Hover a chip for the full path or title.
  A todo, session, ticket, or pull request chip opens it here in the dashboard: the todo in its list, or in **Archive** once put away; a deleted todo's chip opens nothing.
- A session's header shows its title, as in `Fix login`; a session without a title shows its workspace, the last segment of its working directory (`~/code/webapp` reads `webapp`).
  First among the controls on the right, before the ticket and pull request buttons and **End session**, or **Resume** for a past session, the header shows the branch the session works on, such as `me/fix-login`.
  In a linked worktree it is the branch checked out there now.
  In a repository's main checkout it is the branch checked out there when the session last wrote, so a past session keeps its branch after the checkout moves to another one.
  A session on a detached HEAD, outside git, or in a directory that is gone shows no branch.
- Right after a session's title, live or past, before the trajectory switch, a copy button copies the session's ID, which its tooltip names; its icon turns into a check mark for a moment.
- On the right of a session's header, the ticket button names the first Linear issue the session worked on, such as `ENG-2508`, with `+N` for the others.
  Its menu opens each one on Linear, once your assigned issues have loaded and so name your Linear workspace, or in its details on the tickets page; the button shows only for a session with a Linear issue.
- Next to it, the pull request button names the first pull request the session submitted or worked on, such as `#6595`, with `+N` for the others.
  Its menu opens each one on GitHub, on Graphite, or in its details on the Pull requests page; the button shows only for a session with a pull request.
  Past sessions show both before **Resume**.
- Next, before **End session**, a running session that the dashboard can prompt shows **Open PR** while it works on a branch other than its repository's default branch and GitHub names no pull request from that branch.
  The default branch is the one `origin/HEAD` names, so a repository whose clone never recorded it shows no **Open PR** until `git remote set-head origin --auto` records it, which a session there notices at its next write.
  **Open PR** sends the session one prompt: commit the finished work, collect the diff against `origin/<default branch>`, run one `thermo-nuclear-code-quality-review` subagent on it, apply its in-scope findings that keep behavior the same and list the skipped ones with a reason, run the project's checks again, push, open the pull request with `gh pr create`, and report its link.
  The prompt shows in the transcript as yours, and while a turn runs it waits as a queued follow-up, as a message the composer sends then does.
  The button reads **Opening PR…** and takes no second press, there or in the command menu, from the press until the session is next idle after it took the prompt, through messages you steer or queue meanwhile and questions it asks.
  Taking the queued prompt back out while a turn runs keeps **Opening PR…** until that turn ends.
  It goes once the dashboard learns of the new pull request: as soon as the session's transcript names it, such as by the link `gh pr create` prints, else at the next read of the pull request list; a second send before then reports the open pull request's link and stops.
  **Open pull request** in the command menu does the same for the focused pane's session while the panes show.
- The composer names a session's model by its label, next to the logo of the org that makes it (`anthropic/claude-opus-5-5` reads `Opus 5.5` with the Anthropic logo).
  The label leaves out the provider, the vendor prefix, and a release date, joins version parts with dots, and puts a `:` suffix such as a thinking level in parentheses (`Sonnet 5.5 (high)`).
  For a router model such as `openrouter/moonshotai/kimi-k3`, the org is the one the id names.
  Hover it to see the full model selector.
  The settings page labels models the same way.
- Click the branch of a pull request's details, of a session's header, or of a Linear issue's detail view to copy it; its icon turns into a check mark for a moment.
  A long branch name keeps its start and end with `…` in the middle, in a branch picker, a pull request's branches, a session's header, a Linear issue's branch, and a stack's base name; its full name shows on hover where the label has no tooltip, and copying still copies the full name.
  Copying the branch of a session's header also removes the linked worktree that has it checked out, so you can check the branch out elsewhere, and keeps the branch.
  It applies the checks of **Settings → Worktrees**: it never removes a repository's main checkout, a locked checkout, one with uncommitted or untracked changes, one a live session or this dashboard uses, or one with a nested repository.
  A toast names the worktree it removed, or the one it kept and why; a branch that no linked worktree has checked out shows no toast.
  Copying the branch of a pull request's details or of a Linear issue only copies.
- A live session's header shows no connection status.
  It says **Connecting…**, **Reconnecting…**, or **Disconnected** only while the pane is not live; the sidebar's status dot tells whether the session works, idles, or waits on a question.
