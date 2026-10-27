# Send later

- The clock button beside the attach button sends the composer's message later instead of now, in a live session or in the new-session draft; it shows only once the composer holds text.
  Its menu offers each plan window that resets later, such as **When Anthropic 5h resets**, used-up windows first, then **In 1 hour**, **Tomorrow morning** at 9:00, and a date and time field with **Schedule**.
  A reset sends one minute after the window resets, so the provider counts the new window when the message arrives.
  The plans are the ones the status bar shows; see [Plan quota](../architecture/plan-quota.md).
- Scheduling saves the message on the server and clears the composer.
  The send goes whether or not a page is open, as long as the dashboard runs.
- A message scheduled in a session shows above its composer, with its time, or the plan window and the time it resets.
  **Send now** sends it at once, **Edit** takes it off the schedule and then puts it back in the composer, and **Cancel** drops it.
  A message that is already sending stays as it is, and **Edit** says why instead.
- When the time comes, the message goes to the session as a follow-up while a turn runs, else as a prompt.
  A session that is no longer live resumes first, as **Resume** would.
- A scheduled new session starts as the draft's **Start session** would: in the same directory, on the same branch choice, model, thinking level, and skill, and linked to the draft's todo.
  It opens in no pane; it shows in the sidebar once it starts.
- The sidebar's **Scheduled** group, such as **2 scheduled**, sits at the top of the list and lists every scheduled send, new sessions too, in the session rows' look: the message and its time on the right; under all workspaces a new session's row also shows its workspace badge. It hides while nothing is scheduled.
  Each sessions-sidebar group title starts with its own icon: an alarm clock for scheduled, then pinned, idle, running, interrupted, and past.
  A message's row opens its session, and each row's menu has **Send now**, **Edit**, and **Cancel**.
- A scheduled new session's row, or its **Edit**, opens it as the new-session draft it was scheduled from, at `#scheduled/<id>`: its message, directory, branch, model, thinking level, and skill.
  The header shows its time, with **Start now** and **Cancel**. Sending the message saves the edits and keeps the time, and the clock button moves it to another time.
  **Start now** saves the edits, then starts it at once. A send that is already sending refuses edits.
- A send that fails, such as a session that cannot resume, stays listed in red with the error, and **Try again** or **Dismiss** in place of **Send now** and **Cancel**.
  It never tries again on its own.
- A scheduled message carries text only: the clock button is off while the draft holds attached files or starts with a `!` or `$` command.
- Sends go on the dashboard's minute tick, so a send can go up to a minute after its time.
  A send whose time passed while the dashboard was closed goes at the first tick after it starts.

## Continue after a usage limit or a connection error

- When a provider's usage limit ends a turn of a session the dashboard started, such as MiniMax's `429 Token Plan usage limit reached` or Anthropic's used-up 5-hour window, the dashboard schedules `continue` for that session, the way **Send later** would.
  It reads `omp usage` again then, and when every account of that provider has a used-up window, it waits until the soonest account's windows reset, one minute after, such as **Continues when Anthropic 5h resets · Today at 14:32** above the composer.
  Otherwise it waits as long as the provider's error asked, **Continues when Anthropic limit resets**; when the error names no wait, it tries again in one hour and the row says the provider did not say when its limit resets.
  Only the main agent's turn counts: a turn whose subagents hit the limit continues once the main agent's own turn ends on it, and the subagents get no continue of their own.
- When a connection or provider fault ends a turn of a session the dashboard started, after omp's own retries inside the turn gave up, such as `Couldn't reach chatgpt.com (getaddrinfo ENOTFOUND)` or `Anthropic stream stalled while waiting for the next event`, the dashboard schedules `continue` too, one minute later, such as **Retries after a connection error to Anthropic · Today at 14:32**.
  Each fault in a row waits twice as long as the one before: 1, 2, 4, 8, then 16 minutes.
  After five retries in a row that each ended the same way, the dashboard schedules nothing and leaves the session idle; a fault after that starts over at one minute.
  A turn that ends any other way, an edited prompt, and **End session** start the count over, and so does a dashboard restart.
  A usage limit wins over a fault, so a `429` that names a used-up plan waits for the reset instead.
- The row has **Send now**, **Edit**, and **Cancel**, as a scheduled message does, and the sidebar's **Scheduled** group lists it as a continue after the provider's usage limit or a retry after the provider's connection error.
- A session waits on one continue at most: a later limit moves it to the new reset, and a later fault to its next retry.
  Any new turn of that session cancels it, whoever sends the prompt: you or a scheduled message; so do an edited prompt and **End session**.
- Until the continue goes, fails, or you cancel it, the session stays on its task: **After a merge** does not end it.
  The sidebar still shows it idle, and it stays on its task when the dashboard restarts.
- omp's own `retry.waitForUsageReset` setting instead keeps the turn waiting inside omp, so a turn it holds never ends on the limit.
