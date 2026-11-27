# Board

The **Board** is where you and your sessions hand each other work, one list per Workspace, like a Slack channel whose messages are Board tasks.
Each message you send is a **Board task**, and a new session starts on it straight away.
Open it from the **Board** tab at the top of the sidebar, beside **Sessions**, at `#board`; **Sessions** brings back the page list and the sessions.

## The page

- Under the Board tab, the sidebar lists your Workspaces; a count beside one says how many of its Board tasks are ready, which leaves out one whose session did not start.
  Under each Workspace are its running sessions that posted, replied, or were started on its Board tasks; a stopped one drops out of the list, and a click opens the Board thread of the Board task it works on with that session's tab in front, even when a later session took the Board task over.
  The address names the session as `session=<id>`, so a reload keeps it.
- **Notifications** and **Settings**, above the Workspaces, open their page with the sidebar still on the Board; **Sessions** switches it back.
- The page reads like a Slack channel: a `#` header with the Workspace's name, then its Board tasks as messages, oldest first and newest at the foot, split by day.
  Each message shows its author's picture, name, and time, its text, its `#` number, its status, and its `key=value` labels; a session's name carries a **Session** tag and opens that session.
  A later message from the same author within five minutes drops the picture and name, and shows its time on hover.
- Tabs under the Workspace's name switch what the page shows, as a Slack channel's do: **Messages**, the Board tasks, then **Routines**, the Workspace's [routines](routines.md), **Pull requests**, the open pull requests of its repositories, read for this Workspace whatever the sidebar picker shows, **Memory**, its repository's project memory, **Projects**, the projects made in this Workspace from that tab, plus those made on the Projects page with a session in it, and **Settings**, the Settings sections of the Workspace group, from Models to Worktrees, kept to this Workspace with no workspace picker.
  Each tab has its own address, such as `#board/routines?workspace=<cwd>`, and so does each settings section, such as `#board/settings/worktrees?workspace=<cwd>`; the Board thread opens only on **Messages**.
- A routine, a project, or a pull request opened from **Routines**, **Projects**, or **Pull requests** shows inside that tab, at an address such as `#board/routines/<id>?workspace=<cwd>`, `#board/projects/<id>?workspace=<cwd>`, or `#board/pull-requests/<owner>/<repo>/<number>?workspace=<cwd>`: for a project or a pull request, the rest after `#board/` is the page's own address, and every link on the page stays in the tab.
- A Board task a routine posted shows the routine's name as its author, with a repeat icon for its picture; the name opens the routine in the **Routines** tab, and reads as plain text once the routine is deleted.
- A quiet done, the one line a session leaves when a routine's Board task found nothing to report, adds nothing to the thread's unread count.
- The **Projects** tab lists its projects in a resizable column at the left, with **Search projects**, **All projects**, which shows the table at the right, and **New project**; open projects come first, archived ones under **Archived**, and the project you pick opens at the right.
- A Board task's status reads **ready**, **waiting on #N** while a Board task it needs is not done, **Starting a session…**, **Working on it…** or what its session waits on you for, **Couldn't start a session** with the reason and **Reply to try again**, or **done**.
- Under a message with replies, a line shows who replied, how many replies, its unread count, and when the last came; hovering it adds an arrow and keeps that text in place.
- Hovering a message shows a toolbar: **Reply in thread** opens its Board thread, the arrow opens the session working on it, and on a Board task not done yet **Close task**, the check mark, marks it done as you.
  Closing ends the session working on it, and the Board thread notes that you closed it; a reply reopens it as it does any done Board task.
- On your own messages the toolbar also has **Edit message**, the pencil, on the Board and in a Board thread: it puts the text in a box where Enter or **Save** saves it, Shift+Enter starts a new line, and Escape or **Cancel** leaves it as it was.
  Saving stops the turn of the session working on that Board task and sends it the new text, and the message shows "(edited)"; editing a Board task's text also changes its title to its first line.
  A Board task no session started on yet just takes the new text, which its session reads when it starts; a done one stays done.
- The **Board thread** opens in the right pane under the same tab row as a session's right sidebar, with × to close the thread.
  **Thread** shows the Board task, a line with the reply count, and the replies: what you and its sessions said, and grey lines for a session that did not start, your closing the Board task, and the Board's merges, but nothing about claims or wakes.
  Under each session's last reply, a line per thing that session did shows its company's logo, Git, GitHub, or Linear, and its name, so you see it before you merge: the Linear issues it saved, the branch it worked on, and the pull requests it opened or worked on. Hover a line to see which it was.
  A session that has not replied yet shows its lines at the foot of the thread.
  A pull request opens on GitHub; a Linear issue opens the **Linear** tab.
  The next tab, named after the session the address picked, else the one a reply would wake, shows that session's conversation: with its composer while it runs, read-only once it stopped, when a reply in **Thread** wakes it.
  The + opens that session's sidebar tabs, **Overview**, **Diffs**, **PRs**, **Artifacts**, **Review**, and **Linear**, and opens **PRs**, **Linear**, or **Review** by itself once the session has one; the thread keeps the tabs you open across Board threads.
  The open Board task is highlighted in the list, and the pane follows new replies to the bottom.
  The cross or Escape closes it.
  Drag its left edge to widen or narrow it, or use the arrow keys on that edge; a double-click puts it back to its usual width, and the page remembers the width.

## Search

- The search field in the Board's header searches as Slack's does: type words and press Enter, and every message holding all of them lists newest first, with the words marked.
  It reads Board tasks, their labels, and the replies; a session reply's `Suggestions:` block does not count.
- The chip at the front of the field picks where to look: the open Workspace, the open Board thread, or all Workspaces.
  The magnifier in the Board thread's header searches that thread.
- The results take the place of the Board's messages; each names its Workspace and Board task, and a click opens its Board thread with the reply highlighted and scrolled into view.
  With no results, a button searches all Workspaces.
- Escape clears the field, then closes the results; so does the ×.
  The address keeps the search, so Back returns to it.

## Post a Board task

- Type in the composer at the foot of the page and press Enter; Shift+Enter starts a new line.
  It is the New session composer without its directory picker: pick the model, thinking level, and skill the session runs on, `/` and `@` suggest, the microphone dictates, and the paperclip, a drop, or a paste attaches files; it schedules nothing.
  An attached image is saved under `~/.local/share/omp-agents/board-images/` and shows under the message, and the session reads it from that path; a text file or document goes into the text as in a session.
  The first line is the title, and the rest is the detail.
- The sidebar's Workspaces switch the Board to another Workspace.
- A session's `board` tool can make a Board task wait on another one, which starts its session only once that one is done.
- A session starts in the Workspace for every ready Board task, in a worktree of its own on the branch `board/<number>` in a repository; the session holds the Board task from its start.
- Before it adds that worktree's dependencies with the setup of the repository's `.omp/land.json`, the Board checks that you trust the project as it is now; a project you have not trusted, or whose setup fails, does not start a session, and the Board task shows **Couldn't start a session** with the reason.
  The worktree goes again, so the next try sets it up anew.
- When 3 sessions in a row exit without marking a Board task done, the Board stops starting new ones on it and shows **Couldn't start a session**; your reply tries again.

## Reply

- Type in the box at the foot of the Board thread and press Enter or **Send**.
  It is the same composer as the page's: pick the model, thinking level, and skill the woken session runs on, `/` and `@` suggest, the microphone dictates, and each Board thread keeps its unsent reply.
  A session running in a terminal keeps its own model; the skill still applies.
- The reply goes to the session that holds the Board task, or the session that posted it. It wakes that session if it stopped.
  The box says who it reaches.
- On a done Board task, or one whose session did not start, your reply reopens it on the model, thinking level, and skill picked in the box.
  When the session that marked it done can resume, it takes your reply with its whole earlier conversation and the Board thread since; otherwise a new session starts, reads the whole Board thread and the names of the sessions before it, and carries on from their branch.
  The reply box says so: **Reply to try again…** on a Board task whose session did not start.

## How a session finishes

- A session started on a Board task finishes it on its own: it commits its work on its branch, or opens a draft PR in a repository that ships through pull requests, and never merges unasked.
- It marks the Board task done with a message that says what it did, names its branch or pull request, and ends on suggested next steps; once that turn ends, the Board ends the session, so nothing stays running.
  It suggests **Merge on main** only where the repository has a `.omp/land.json` to land with.
- The suggested next steps show under the thread's reply box, as under a session's composer, with the same keys: Enter sends one, Tab fills it in to edit first. Sending one is your reply, which the session that marked the Board task done picks up; typing your own reply does the same.
- A bare **Merge on main** on a done Board task with a branch starts no session: the Board lands the branch itself, as the `land` tool does, once you trust the project, and notes the outcome in the Board thread.
  A landed branch, or one with nothing left to merge, keeps the Board task done; a failed merge reopens it and the session that marked it done takes it again; a repository with no `.omp/land.json`, or a project you have not trusted, keeps it done with a note saying why it did not merge.

## What sessions do

- Sessions use the `board` tool to post Board tasks, reply, claim one, mark one done, list the Board, and read a Board thread.
  A session the Board started holds its Board task already; a session you run yourself claims one to work on it.
- When the session holding a Board task exits without marking it done, the Board task is ready again after 30 seconds and a new session starts on it, up to 3 in a row.
- Marking a Board task done makes every Board task that needs it ready, and a session starts on each.
- The tool comes with the starter kit; a subagent acts for the session that started it.
- Only the dashboard that runs the unattended work writes the Board, starts sessions, and wakes them; see [Architecture: Board](../architecture/board.md).
