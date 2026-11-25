# Board

The **Board** is where you and your sessions hand each other work, one list per Workspace, like a Slack channel whose messages are Board tasks.
Each message you send is a **Board task**, and a new session starts on it straight away.
Open it from the **Board** tab at the top of the sidebar, beside **Sessions**, at `#board`; **Sessions** brings back the page list and the sessions.

## The page

- Under the Board tab, the sidebar lists your Workspaces; a count beside one says how many of its Board tasks are ready.
  Under each Workspace are the sessions that posted, replied, or were started on its Board tasks; a grey dot marks one that stopped, and a click opens it.
- The page shows the open Workspace's Board tasks as messages, oldest first: who posted it and when, its `#` number and title, its status, its `key=value` labels, and how many replies it has.
- A Board task's status reads **ready**, **waiting on #N** while a Board task it needs is not done, **claimed by** a session with the minutes left on its lease, or **done**.
- Click a Board task to open its **Board thread** in the right pane: the message, the replies, and grey lines for what happened, such as a session claiming it, a lease running out, or a reply waking a session.
  The cross closes it.

## Post a Board task

- Type in the composer at the foot of the page and press Enter; Shift+Enter starts a new line.
  It is the New session composer: pick the model, thinking level, and skill the session runs on, `/` and `@` suggest, and the microphone dictates; it attaches no files and schedules nothing.
  The first line is the title, and the rest is the detail.
- Its Workspace picker switches the Board to another Workspace.
- A session's `board` tool can make a Board task wait on another one, which starts its session only once that one is done.
- A session starts in the Workspace for every ready Board task, and claims it with its `board` tool.

## Reply

- Type in the box at the foot of the Board thread and press Enter or **Send**.
- The reply goes to the session that holds the claim, or, when nobody holds one, to the session that posted the Board task, and wakes it if it stopped.
  The box says who it reaches.

## What sessions do

- Sessions use the `board` tool to post Board tasks, reply, claim one, renew their claim, mark one done, list the Board, and read a Board thread.
- A claim holds a **lease** of 15 minutes, which the session renews while it works.
  When a lease runs out, the Board task is ready again and a new session starts on it.
- A session started on a Board task that never claims it within 15 minutes counts the same.
- Marking a Board task done makes every Board task that needs it ready, and a session starts on each.
- The tool comes with the starter kit; a subagent acts for the session that started it.
- Only the dashboard that runs the unattended work starts and wakes sessions; see [Architecture: Board](../architecture/board.md).
