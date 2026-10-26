# Notifications

- The bell sits after the command menu button at the right of the title bar on macOS, beside the window's title; elsewhere, at the end of the page's header.
  With split panes off macOS, only the top right pane's header shows them, before its details toggle.
- Six sources feed it.
  - **GitHub**: a pull request on the Pull requests page whose move is yours, one notice per move: **Review requested**, **Ready to merge**, **Checks failed**, **Conflicts to resolve**, or **Comments to address**.
    A pull request that a running session works on, or whose session asks you something, is not one, and its notice goes once the pull request leaves the move.
    Every two minutes while a page is open, and as soon as a page opens after none was, the server reads the pull requests of the workspaces that the Pull requests page covers.
  - **Slack**: a message from someone else in a direct or group conversation you have not answered since, one notice per conversation, and each mention of you in a channel, from the last three days.
    It needs the Slack sign-in of **Settings › Integrations**, and the server checks it with the pull requests.
  - **Updates**: a newer omp release or a newer model, checked at startup, every six hours, and after each update, and new commits for omp-agents itself, checked at startup and every five minutes.
    - A newer omp release than the one installed, on the channel that omp's `update.channel` setting picks.
      Turning off omp's `startup.checkUpdate` setting turns this check off too.
    - A newer Claude or OpenAI model than one that your model roles or fallback chains name, from the same provider and the same line, such as Claude Opus 5.5 to Claude Opus 5.6.
      Only models that `omp models` lists on a connected provider count, and dated snapshots are left out.
    - **omp-agents update: N new commits on main**, when the server runs from a git checkout and its branch on origin holds commits past the one it runs.
      One notice stands for the running build, so more commits raise its count rather than toast again.
      The packaged app updates through **omp agents › Check for Updates…** instead.
  - **Providers**: a provider that stopped serving, checked after each `omp usage` run, every minute while a page is open.
    - A plan window that `omp usage` reports used up, such as Cursor's `Other Models`, with when it resets and how many reset credits the plan holds.
      The notice goes once the window resets.
    - A provider whose prepaid credits ran out, such as OpenRouter answering `402 Insufficient credits`: a request to it failed for that in the last day, and none has worked since; the notice counts those failures since the first one.
      A request to the provider that works ends it, and a failure of another kind, such as a dropped connection, neither ends nor counts toward it.
  - **Calendar**: an event with a start time, kept on this computer or of a Google calendar the Calendar page shows, from ten minutes before it starts until it ends, checked every minute.
    All-day events give none, and Google events need the Google Calendar sign-in of **Settings › Integrations**.
  - **Sessions**: the sessions the dashboard started that stopped mid-turn, working or waiting on a question, without **End session**, as one notice, **2 sessions stopped mid-turn**, that names them as the sidebar's past sessions do.
    They are the interrupted sessions of the sessions sidebar whose turn ran, checked as the dashboard starts, every minute, and each time one stops, resumes, or moves to past.
- **All**, **GitHub**, **Slack**, **Providers**, **Calendar**, **Sessions**, and **Updates** filter the list, each but **All** with its source's logo and each with its count of unread notices.
  The tabs scroll sideways when they do not fit, and the one you pick scrolls into view.
  Unread notices list under **New** with a blue dot, and read ones under **Earlier**.
  A pull request's or Slack message's notice shows the picture of who it comes from, or their initial when Slack's sign-in cannot read profiles without `users:read`.
- A notice you open is read: a pull request's opens its details on the Pull requests page, a Slack message's opens it in Slack in your default browser, a provider's opens **Settings › Providers**, and an event's opens it in Google Calendar in your default browser, or the **Calendar** page for an event on this computer.
  Selecting an update's or stopped sessions' notice marks it read.
  The check mark in the header marks every notice in the filter read.
- Each pull request notice offers the move's quick action, such as **Review** or **Fix CI**, which starts a session on it and opens its page, or **Merge** for one ready to merge.
  **Merge** asks before it merges, with the merge methods the repository allows, as the pull request's details do, and marks the notice read once the dashboard took the merge, which it makes at once or once GitHub allows it; when the dashboard refuses it, a toast says why.
- The stopped sessions' notice offers **Continue all**, on the toast or in the bell, which resumes every session it lists and sends each the prompt `continue`, as the sidebar's **Resume all** does, and marks the notice read.
- A notice that no page has shown yet shows as a toast at the bottom right; closing it marks it seen, so it does not show as a toast again in any tab or after a reload.
  Over its title, a toast names where it came from beside that source's logo: GitHub, Slack, the provider, Google Calendar or **Calendar** for an event kept on this computer, omp for an update of omp or a model, or omp-agents for its own and for stopped sessions.
  A pull request's, Slack message's, provider's, event's, or stopped sessions' toast shows only within 15 minutes of its news, and **Open** opens what it is about; an event's news is ten minutes before it starts.
  A pull request's, Slack message's, or provider's toast closes after a few seconds; an event's stays until you dismiss it or the event ends, and an update's or stopped sessions' until you dismiss it.
- **Update**, on the toast or in the bell, runs the update; the notice shows its progress, then what changed or why it failed, and a failed update can run again.
  - For omp, it runs `omp update`, which installs the newest release.
    Restart omp-agents to load it, since the running server keeps the omp it started with.
    An install that `omp update` leaves older than the notice's release, such as one that Nix manages, reports as failed with omp's last line of output.
  - For a model, it puts the new model in place of the old one in every role and fallback chain of `~/.omp/agent/config.yml` that names it, and keeps each role's thinking level, as **Settings › Models** would save it.
    A chain keyed by the old model keeps its key, and a workspace's `.omp/config.yml` stays as it was.
  - For omp-agents, it is **Update dashboard**, as in [Updating omp-agents](updating-omp-agents.md).
- **×** clears a notice from the bell.
  A cleared update comes back with a newer version, a cleared pull request notice when the pull request comes back to the move after a while, a cleared Slack notice with a newer message, a cleared plan notice when the window runs out again a while after it reset, a cleared credits notice when the credits run out again a while after a request worked, and a cleared stopped sessions' notice when another session stops mid-turn; one that only resumes keeps the notice cleared, seen, or read as it was.
- The server keeps which notices were seen, read, and cleared in `notices.json` beside its access token.

## Session notifications

- A live session that asks you something, or finishes a turn, raises a system notification while the dashboard's window does not have focus.
  Its title is the session's, and its text is the question, or the first line of the turn's last reply.
  Clicking it brings the window up on that session.
- Each question and each finished turn raises one notification, and a newer one of the same session replaces the one before; a session that asks while its turn is unread notifies the question.
  A session that already waited when the page loads, or when the page reconnects, raises none.
- A finished turn stays unread until a pane shows the session, not one of its subagents, in a focused window, or its next turn starts; the server keeps which turns are unread, so every window agrees.
- The app shows them unless **Settings › Preferences › Notifications** turns them off, and keeps that switch in its localStorage.
