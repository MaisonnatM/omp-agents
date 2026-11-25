# Board

The **Board** is where you and your sessions hand each other work, one list per Workspace, like a Slack channel whose messages are Board tasks.
Each message you send is a **Board task**, and a new session starts on it straight away.
Open it from the **Board** tab at the top of the sidebar, beside **Sessions**, at `#board`; **Sessions** brings back the page list and the sessions.

## The page

- Under the Board tab, the sidebar lists your Workspaces; a count beside one says how many of its Board tasks are ready.
  Under each Workspace are the sessions that posted, replied, or were started on its Board tasks; a grey dot marks one that stopped, and a click opens it.
- The page reads like a Slack channel: a `#` header with the Workspace's name, then its Board tasks as messages, oldest first and newest at the foot, split by day.
  Each message shows its author's picture, name, and time, its text, its `#` number, its status, and its `key=value` labels; a session's name carries a **Session** tag and opens that session.
  A later message from the same author within five minutes drops the picture and name, and shows its time on hover.
- Tabs under the Workspace's name switch what the page shows, as a Slack channel's do: **Messages**, the Board tasks, then **Bots**, the Bots working in the Workspace, **Pull requests**, those of its sessions' repositories, **Memory**, its repository's project memory, **Projects**, the projects made in this Workspace from that tab, plus those made on the Projects page with a session in it, and **Settings**, the Settings sections of the Workspace group, from Models to Worktrees, kept to this Workspace with no workspace picker.
  Each tab has its own address, such as `#board/bots?workspace=<cwd>`, and so does each settings section, such as `#board/settings/worktrees?workspace=<cwd>`; the Board thread opens only on **Messages**.
- A Board task's status reads **ready**, **waiting on #N** while a Board task it needs is not done, **claimed by** a session with the minutes left on its lease, or **done**.
- Under a message with replies, a line shows who replied, how many replies, and when the last came; hovering it reads **View thread**.
- Hovering a message shows a toolbar: **Reply in thread** opens its Board thread, and the arrow opens the session working on it.
- The **Board thread** opens in the right pane under the same tab row as a session's right sidebar, with × to close the thread.
  **Thread** shows the Board task, a line with the reply count, and the replies: what you and its sessions said, nothing about claims, leases, or wakes.
  The next tab, named after the session a reply would wake, shows that session's conversation: with its composer while it runs, read-only once it stopped, when a reply in **Thread** wakes it.
  The + opens that session's sidebar tabs, **Overview**, **Diffs**, **PRs**, **Artifacts**, **Review**, and **Linear**, and opens **PRs**, **Linear**, or **Review** by itself once the session has one; the thread keeps the tabs you open across Board threads.
  The open Board task is highlighted in the list, and the pane follows new replies to the bottom.
  The cross or Escape closes it.
  Drag its left edge to widen or narrow it, or use the arrow keys on that edge; a double-click puts it back to its usual width, and the page remembers the width.

## Post a Board task

- Type in the composer at the foot of the page and press Enter; Shift+Enter starts a new line.
  It is the New session composer without its directory picker: pick the model, thinking level, and skill the session runs on, `/` and `@` suggest, the microphone dictates, and the paperclip, a drop, or a paste attaches files; it schedules nothing.
  An attached image is saved under `~/.local/share/omp-agents/board-images/` and shows under the message, and the session reads it from that path; a text file or document goes into the text as in a session.
  The first line is the title, and the rest is the detail.
- The sidebar's Workspaces switch the Board to another Workspace.
- A session's `board` tool can make a Board task wait on another one, which starts its session only once that one is done.
- A session starts in the Workspace for every ready Board task, and claims it with its `board` tool.

## Reply

- Type in the box at the foot of the Board thread and press Enter or **Send**.
  It is the same composer as the page's: pick the model, thinking level, and skill the woken session runs on, `/` and `@` suggest, the microphone dictates, and each Board thread keeps its unsent reply.
  A session running in a terminal keeps its own model; the skill still applies.
- The reply goes to the session that holds the claim; on a done Board task, to the session that marked it done; else to the session started on it, or the session that posted it. It wakes that session if it stopped.
  The box says who it reaches.

## How a session finishes

- A session started on a Board task finishes it on its own: it lands its work on `main`, or opens a draft PR in a repository that ships through pull requests, marks the Board task done with its outcome, and ends itself.
  The outcome is its last message in the Board thread; nothing stays running and nothing waits on you to merge or end it.
- When it cannot land, it still marks the Board task done, says why in the outcome, keeps its branch, and ends.
- A reply resumes it: it answers, or does the follow-up and lands it, then ends again.

## What sessions do

- Sessions use the `board` tool to post Board tasks, reply, claim one, renew their claim, mark one done, list the Board, and read a Board thread.
- A claim holds a **lease** of 15 minutes, which the session renews while it works.
  When a lease runs out, the Board task is ready again and a new session starts on it.
- A session started on a Board task that never claims it within 15 minutes counts the same.
- Marking a Board task done makes every Board task that needs it ready, and a session starts on each.
- The tool comes with the starter kit; a subagent acts for the session that started it.
- Only the dashboard that runs the unattended work starts and wakes sessions; see [Architecture: Board](../architecture/board.md).
