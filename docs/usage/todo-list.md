# Todo list

- The **Todo** tab, or a `#todo` address, opens todos of your own, not tied to a session, in place of the panes; a top-level todo can name the workspace it is about, and every list still shows todos of every workspace.
  The sidebar then lists **All**, **Today**, **Needs you**, **From agents**, and **Archive**, then your categories, each with how many top-level todos are open in it.
  Each category has a color checkbox, and its todos carry a badge of that color.
  Click one to show its todos alone; `#todo/today`, `#todo/needs`, `#todo/agents`, `#todo/archive`, and `#todo/<category id>` address them.
  Uncheck a category to keep its todos out of **All**, **Today**, **Needs you**, and **From agents**, and out of their counts; its own list still shows them, and the app keeps the choice, on every machine through Settings › Sync.
  **All** lists every todo in one list, each top-level todo with its category's badge; a category's own list shows no badges.
  **Today** lists the todos due today or before, or with a todo under them that is, earliest due first; **Add a todo due today** there adds one due today.
  **Needs you** lists open todos whose latest linked session has a question open or is idle, wherever that session ran.
  **From agents** lists the todos that an agent added; see [Todos from agents](#todos-from-agents).
- The **+** beside **Categories** adds a category; type its name and press Enter, and the page opens it.
  A category's **⋯** menu renames it or deletes it; deleting a category keeps its todos, in no category.
- **Add a todo** at the end of a list's **Todo** group, or C outside a text field, starts a new todo in that list's category, in the sidebar's selected workspace, or in none under **All workspaces**; type its title and press Enter.
  The **+** in a group's header starts one of that group's status instead.
  Enter then starts the next todo below it, of the same status, and Enter on an empty one, Esc, or a click elsewhere stops.
- A new todo's title, here or in the command menu's **Create todo**, can end with a due day: `today`, `tomorrow`, a weekday such as `fri` or `friday`, or a `YYYY-MM-DD` date.
  A new top-level todo's title can also end with `#` and the name of an existing category in any case, before or after the day.
  They set the todo's due day and category and leave its title, and a word that names neither stays in the title.
  A weekday names its next date, today included.
- Cmd+Enter or Ctrl+Enter on a new or edited top-level todo saves it and opens its **Start session** draft.
- A todo can hold todos of its own, one level down and no deeper, and they share its category and its workspace.
  Tab while typing a todo moves it under the todo above it, and Shift+Tab moves it back out, with the todos below it, so the list reads in the same order.
  Tab does nothing on a todo that holds todos of its own, since they would end up three deep, nor on one with links, which a todo under another cannot hold.
  The **+** that shows on hover adds a todo under that one.
- A todo has a status, as a Linear issue does: **Backlog**, **Todo**, **In Progress**, **Done**, or **Canceled**; a new todo is **Todo**, and Done and Canceled close it.
  It also has a priority on Linear's scale: none, **Urgent**, **High**, **Medium**, or **Low**.
  It can be assigned to **You** or to an **Agent**, or to no one, as a new todo is; assigning an agent only records who should do it, and starts no session and changes no status.
- Every list but **Archive** groups its top-level todos by status, **In Progress**, **Todo**, **Backlog**, **Done**, then **Canceled**, each under a header with the status's icon, its name, and how many todos it holds; click a header to fold or unfold its group.
  **Done** and **Canceled** start folded, the app keeps what you fold, and a search unfolds every group.
  A group with no todo hides, except **Todo** in a list you can add to.
  Within a group, todos keep the list's own order: the one you set, or the earliest due day for **Today**.
- Drag a todo by its row to move it among the todos of its status beside it, top-level ones in **All** and a category, and a todo under another among its parent's.
  A dragged todo keeps its category; change it from the open todo.
  Alt+Shift+↑ and Alt+Shift+↓ move the focused todo one place the same way.
  **Today** sorts by due day and **Archive** by when it was cleared, so neither moves todos.
- A row shows the todo's priority as an icon when it has one, its status as an icon, its title, then what it carries, its assignee's icon when it has one, and the day it was added; a todo under another has its own priority, status, and assignee.
  Click the status icon, or the priority icon when there is one, to pick another, or press S or P outside a text field for the focused todo, or else the open one; while the menu is open, the digits pick a choice, 1 to 5 for a status and 0 to 4 for a priority.
  The open todo's **Priority** button sets a priority too.
  A does the same for the assignee, with 0 for none, 1 for **You**, and 2 for **Agent**, and Shift+D for the due day.
  Closing a top-level todo, as Done or Canceled, closes the open todos under it the same way.
  At both levels, open todos come first and closed ones after them, so a todo under an open one moves below the ones still open beside it once it closes, and reopening a todo puts it last among them.
  An open top-level todo linked to a session shows a work-state dot in the list and a pill in the open todo, instead of repeating the session's name: **Agent working**, **Needs you**, **In review**, **Shipped**, **Session ended**, or **Session unavailable**.
  Hover the dot for its state; the dot and the pill open the latest linked session, and do not change the todo's status or category.
  A todo that holds others shows how many of them are done, as in `2/3`, right after its title.
  The page's header counts the open top-level todos, and **Clear done** moves every Done and Canceled todo it lists to **Archive** at once, a closed todo under an open one as a todo of its own.
  The server does the same by itself for a todo closed over 24 hours ago, when it starts and every minute after.
- **Archive** lists the cleared todos, latest first, with the day each was closed.
  Hover one to put it back last in the list, in its category if that still exists, or to delete it for good, or right-click it for **Open**, **Put back in the list**, and **Delete for good**; **Empty** deletes them all, after you confirm.
  The todo keys step through its rows as through any list's, and Enter opens the focused one.
- Click a todo to open its details on the right of the list, as in Linear, and double-click it to rename it in the list.
  Arriving at a list, from the **Todo** tab, its number, or a list in the sidebar, opens the todo on its top row.
  Closing it leaves the list with nothing open, and that side then says how to open one.
  Drag the line between the list and the details, or focus it and use the left and right arrow keys, to size the list; double-click it to reset, and the app keeps the width.
  A page too narrow for both shows the open todo in place of the list, and its **×** goes back to the list.
  The open todo's bar names its category, its parent for a todo under another, and its status; its ↑ and ↓ open the todo above and below in the list, and **×** closes it.
  The address names the open todo, as `#todo/<category id>?open=<todo id>`, so a reload or a link returns to it.
  A search keeps the open todo on the right even when it hides its row.
  An empty title, or Backspace in an empty one, deletes the todo, and so does the **×** that shows on hover; deleting a todo deletes the todos under it.
  **Undo** shows for eight seconds after a delete and puts the todo back where it was, with its todos, notes, and links.
- Right-click a todo, or focus it and press the context-menu key or Shift+F10, for **Open**, **Rename**, **Add a todo under it** on a top-level todo, and **Delete**.
- The search field in the page's header, or `/` outside a text field, keeps the todos whose title or notes, or a todo under them, hold every word typed; Esc clears it.
  Outside a text field, ↓ and ↑ focus the next and previous todo, X marks the focused or open one **Done**, or a closed one **Todo** again, and Enter opens it.
  While a todo is open, ↓ and ↑ open the next and previous one instead, and Esc closes it.
- An open todo shows its title, which you edit in place, with Enter or a click elsewhere saving and Esc undoing.
  Under it, buttons show its status, its priority, its assignee, its category and its **Workspace** for a top-level todo, and its due day, each opening a menu to change it; the due day's menu also clears it.
  The **Workspace** menu lists **No workspace** and the workspaces the sidebar lists, each by folder name and path.
  A top-level todo with a workspace shows a folder chip with its name in the list, whose tooltip gives the path its sessions start in.
  A todo due today reads **Today**, and one whose day has passed reads **Overdue** in red.
  Its notes follow, always formatted.
  Click into them and type: markdown at the start of a line formats it as you type, `# ` a heading, `- ` a bullet, `1. ` a numbered list, `[ ] ` or `[x] ` a check item, `> ` a quote, and ```` ``` ```` a code block.
  Around text, `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, and `[text](url)` format it too, and a typed or pasted URL becomes a link; a click on a link opens it in your default browser, and a click on a check item's box ticks it.
  The notes save a moment after you stop typing or tick a box, and at once when you click away, on Esc, or on Cmd+S; they are kept as markdown, and a todo with notes shows a notebook icon in the list.
  Underline and other formatting that markdown cannot hold, as Cmd+U or a paste would bring, does not apply.
  A GitHub table and raw HTML are not formatting the editor knows: they show and save as the text you wrote, one block per line.
  Saving an edit rewrites some markdown the way the editor writes it: a sublist indents four spaces, and `_italic_` and `__bold__` become stars.
  A `*`, `_`, `` ` ``, or `~` you type saves as typed, unless one in the note would read as formatting; then each of them saves after a backslash.
  A top-level todo's **Notes** section also lists separate [Notes page](notes.md) notes linked to it, with **+** to create one titled after the todo.
  A top-level todo then lists its sub-todos, with how many are done, a bar of that share, and each one's status and its priority when it has one; click one to open it, and the **+** adds one.
  A card then shows its latest linked session's work state and, when that live session has a question open, its title and **Reply in session**, which opens that session.
  For an open todo, the card's **Work on it** and **Plan it** start a session on it at once, and **Start session** opens the draft; with no linked session, only those buttons show.
  At the bottom, it shows the day it was added and the session that added it.
- A top-level todo shows what it links to: a session, a pull request, or a Linear issue, as an icon in the list and a chip under **Links** in the open todo, each opening it here.
  Each shows the icon of the sidebar tab it opens: **Sessions**, **Pull requests**, or **Tickets**.
  A running session shows its status dot; an open todo's **×** on a chip unlinks it.
- An open top-level todo's **Work on it** and **Plan it** start a session at once, in the todo's workspace, else the sidebar's, through the pinned skill when one is pinned, and link it to the todo.
  **Work on it** does what the todo asks from its title, notes, and open sub-todos, in a git worktree on a new branch when it changes code, then commits and reports without pushing.
  **Plan it**, on a todo not **In Progress** yet, reads what the todo concerns and reports a plan without changing anything.
  The button waits while the session starts, and a start that fails says why in the card, naming the todo by its title.
- An open top-level todo's **Start session** opens the new-session draft with its title and notes as the first message, in the todo's workspace, else the sidebar's, to edit the prompt or pick another directory first; `#new/<cwd>?todo=<id>` addresses it, and its directory wins over the todo's.
  A session started from a todo links to it once omp starts, which moves a **Backlog** or **Todo** todo to **In Progress**, and its agent marks the todo **Done** once it finishes the work; see [Todos from agents](#todos-from-agents).
- With Linear connected, an open top-level todo's **Create Linear ticket** asks for a team, starting with the last one an issue was created in, then opens an issue from the title and notes, assigned to you, and links it to the todo.
  It reports success only once the server's todo list holds the link.
  When the issue opened but the todo did not take the link, it names the issue and offers **Link** for it instead of opening another.
- The list icon on a ticket adds a todo of no category, last in the list, that links to it.
- The server keeps the list in `todos.json` beside its access token, so every window of the app shows the same list, and a change in one shows in the others at once.
  A `todos.json` from before categories, notes, due days, links, the archive, statuses, priorities, or assignees still loads, with none of them; a todo checked then reads as **Done**, an unchecked one as **Todo**, both with no priority.
  A `todos.json` that the server cannot read as a todo list is moved to `todos.json.invalid` rather than written over.
  While the page has lost the server, the list cannot be changed.

## Todos from agents

- The `user_todo` tool lets an omp session list your todos, add one, check one off, which marks it **Done**, edit one's title, notes, due day, category, or workspace, or delete one; it cannot set another status, move a todo, or add, rename, or remove a category.
  It comes from `~/.omp/agent/extensions/todos.ts`, which `bun run omp-template` installs.
- An agent adds a todo when it stops on a step outside the session that only you can take, such as setting up an account or a credential, running something on your machine, or reviewing a pull request.
  It asks for an approval or an answer in its reply, not in a todo.
  The todo lands last, as **Todo** with no priority, in no category unless the agent names one that exists; when the category it names does not exist, the todo lands in none and the agent is told which categories do, and its chip names the session that added it and opens it.
  It lands in the workspace the session runs in, a linked worktree counting in its repository's main checkout, unless the agent names another directory, or an empty one for none; a path that is not a directory is refused.
- An agent edits or deletes a todo when you ask it to, or to fix or drop one its session added.
  `edit` changes only the fields it names: its notes replace the todo's, an empty `due` clears the due day, an empty `section` takes a top-level todo out of its category, and an empty `workspace` takes it out of its workspace; a todo under another has no category or workspace of its own.
  `edit` and `delete` refuse an id the list lacks, and a deleted todo leaves the list and the archive with no undo.
- At each prompt, a session is told which open top-level todo links to it, such as the one its **Work on it**, **Plan it**, or **Start session** started, and which open todos it added.
  Its agent checks a linked todo off once it finishes the work, and leaves it open while the work still waits on you.
  It checks off a todo it added once you have done the step or it no longer applies, and adding a todo it already added, with the same title, returns the open one.
  Any agent also checks off a todo whose work you ask it to do.
- `add` and `check` take an empty `due`, `text`, or `id` as absent; `edit` refuses an empty `text`.
- The tool leaves each change as a file in `todo-inbox/` beside `todos.json`, and the server applies it and deletes the file, so a todo an agent adds while the dashboard is down shows once it starts.
  A file that is not a change an agent may make, an add, a check, an edit, a workspace change, or a deletion, moves to `<name>.invalid`.
  The server finds an added or changed workspace's main checkout through git, and applies the inbox's changes one at a time, so an edit never lands before the add it edits.
