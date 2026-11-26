# Pull requests

- A session lists the pull requests it submitted or worked on as `#<number>` after its title in the sidebar, and on the pull request button in its header.
  In the sidebar, a session with several shows the first number and `+N` for the rest, for example `#6535 +2`; hover it to read them all, or find each in the row's menu.
  Its subagents' pull requests count as its own.
  A submission is the URL a `gh pr create` call printed from bash output, including bash run as a background job.
  Work is one of the session's own tool calls: `gh pr checkout`, `edit`, `comment`, `review`, `merge`, or `ready` with a PR number or URL; a `git push` whose output shows that it updated a PR's head branch; or an omp `pr://` read of a PR that the session's own prompt names in its repository, as `#7049`, `PR 7049`, or `PR#7049`.
  A pull request link in the session's own prompt is work too; a subagent's prompt, its assignment, does not count.
  Work is also the branch the session works on when a PR heads it: the branch checked out in the linked worktree the session works in, its own directory or the worktree its bash calls last ran in, or in a repository's main checkout a branch other than the default one that `origin/HEAD` names; a switch to another branch links that branch's PR at the session's next write.
  A main checkout's default branch links no PR, since every session started there shares it.
  A bare number belongs to the repository that `origin` names in the session's working directory, unless the command passes `-R` or `--repo`.
  A push or a worktree's branch links once the Pull requests page has listed the PR that the branch heads or GitHub has answered which PR the branch heads, which the dashboard asks when the session names a new PR, and else at most once a minute.
  A PR the session only read, quoted, listed with `gh pr list`, or looked up with `gh pr view` does not count, unless its prompt names it or it heads the session's worktree branch.
  A PR that a session submitted counts as submitted, even when it also worked on it.
- In a session's header, the pull request button opens a popover with one row per pull request: the row opens its details on the Pull requests page, and the GitHub icon at its end opens it there.
  When two or more of the session's open pull requests stack on each other by base branch, the button reads **Stack · 3** and the popover draws the stack on a rail, top first, down to the branch it merges into, as a pull request's **Stack** does.
  The session's other pull requests follow under **Also on this session**.
  **Merge stack**, under the rail, merges the whole stack into the bottom one's base, bottom first, after a confirmation with the merge methods the repository allows.
  The dashboard's server merges each one once the one below it merged, retargeting it onto that base, marking a draft ready, and updating its branch as GitHub requires, as a merge that waits until it is ready does; the line under the rail says which one it is on and what it waits on, with **Cancel**.
  It stops at the first one that fails, with the reason, and leaves the ones above it as they are.
- Agents start `/ship` on their own when a request will end in a pull request, and say so in their first reply; answer "no ship" to work without it.
  A /ship run has nine steps: ticket, plan, implementation, draft PR, interface review, thermonuclear review, ready gate, live review, and merged.
  The ticket step links the issue you named or one that matches the work, and passes without one rather than creating a ticket.
  In the plan step the agent compares up to three ways to build the change and posts the one it chose on the Linear issue, or in the PR body when there is no issue.
  omp writes each step to its session file, and the dashboard reads those entries for running and past sessions.
- The sidebar's page list switches pages: **Pull requests**, **Bots**, and **Sport**, each but **Pull requests** with its page's own list in a column at the page's left while it is open.
  Click a tab or use the left and right arrow keys while a bar tab has focus to switch pages.
  The sessions live in the workspace list under the page list; click one to leave a page for its pane, and each workspace counts the live sessions that wait on you.
  The command menu's **Go to sessions**, while a page shows, opens the panes, or with none open the selected workspace's live session started last, else its past session saved last.
  **Bots** lists your Bots, each with its routines; see [Bots](bots.md) and [Routines](routines.md).
  The tabs show their names, and when the sidebar is too narrow for every name, their icons alone, the row only as wide as its tabs; hover an icon for its name.
  The tabs never spill past the sidebar.
  **Pull requests** opens the Pull requests page, a table of your pull requests, with no list of its own at its left.
  The tab stays on **Pull requests** while you open sessions from it, until you choose **Sessions**.
  On the page, a section's **Your move** count stands out in bold.
  The **Pull requests** tab counts the pull requests that wait on your move, for the workspace that the sidebar's picker shows, and reads GitHub every minute on every page so the count stays current.
  A `#pull-requests` address opens the Pull requests page.
  The pull request list covers the GitHub repository of the workspace that the sidebar's picker shows, or under **All workspaces** every repository that a session ran in, one section per repository.
  A workspace's repository is the one its `origin` remote names.
  A directory removed since its sessions ran, such as a deleted worktree, is no longer a workspace, so quick actions start in a workspace that still exists.
  Each repository lists your open pull requests, your merges from the last seven days, and the open pull requests that ask you for a review.
  They sort by whose move it is: **Your move**, **Agent on it**, **Approved**, **Waiting on others**, **Drafts**, and **Recently merged**.
  A pull request's age, such as `<1m`, `19m`, `17h`, or `2d`, counts up each minute without a reload.
  A badge is coloured only for your moves, each with its own icon and colour, such as red for **Fix CI** and orange for **Rebase**; every other move is grey.
  The Pull requests page's table shows each section as a card, one row per pull request: the move's badge, the title with its author's picture and name, number, conversations, and reason under it, the sessions on it, its place in a stack, its checks, its reviewers or review state, the lines added and removed, its age, and its `⋯` menu at the far right.
  Conversations count the pull request's comments and review threads, resolved ones too, as GitHub's own list does, beside a speech bubble; a pull request with none shows no count.
  Hover the count in the table for a card of the five latest conversations, newest first, each with its author, age, file and line for a review thread, and the start of its first comment.
  The card reads the pull request from GitHub when it opens, leaves out what the **Comments** filter on the details' **Summary** hides, and says how many older or hidden conversations it left out.
  A narrow page drops the sessions, stack, and line columns.
  Each pull request takes the first move that applies, in this order.
  A merge from the last seven days is **Merged**.
  A pull request that a running session asks you about is **Answer**, and one that a running session works on is **Working**.
  An idle session's turn ended, so the move comes back to you.
  A review asked of you is **Review**, with its author as the reason.
  Your own pull request is **Rebase** with merge conflicts, **Fix CI** with failed checks, and **Reply** with requested changes or review threads that wait for a resolution.
  A draft with none of those is **Draft**.
  Every open row whose badge is not **Draft** also shows a **Draft** or **Live** tag before its number, in the sidebar and in the table, so a draft that waits on another move, such as **Rebase**, reads as one.
  It is **Merge** when it is approved or needs no review, its checks passed or it has none, it has no conflicts, and no review thread waits for a resolution.
  It is **CI running** while its checks run, and **In review** otherwise, with the reviewers it still waits on as the reason.
  Once you ask every reviewer who requested changes for a new review, the pull request is **In review** again, though GitHub still reports the change request until they review again.
  **Review**, **Merge**, **Fix CI**, **Rebase**, and **Reply** are your moves, in that order within **Your move**.
  **Answer** and **Working** are the agent's, **In review** and **CI running** wait on others, and **Draft** has its own section, **Drafts**.
  Your approved pull request that is **Merge**, **CI running**, or **Draft** goes in **Approved** instead, so it leaves the **Your move** count; one that needs a rebase, a CI fix, or a reply stays in **Your move**.
  Within a section, the pull requests of each move are most recently updated first.
  When the list holds another pull request of its stack, the row shows its place from the bottom, such as `2/4`, and its tooltip names the branch it is stacked on; otherwise a row stacked on another branch names it, as in `on fix/base`.
  Within a section, a stack's pull requests sit together, top first, where its first one would, and a line joins each to the one below it.
  A row shows one session chip: a running session first, since one may be working on the pull request now, then one that submitted it, then one that worked on it.
  A submitter's chip is filled and a worker's chip is outlined, and a chip's tooltip says which it is.
  A running session's chip starts with the sidebar's status dot: none while it works, amber while it waits on a question, blue once its turn ended.
  `+N` after the chip lists every session on the pull request, each with whether it submitted or worked on it; choose one to open it.
  A pull request whose **Review** session saved a review draft you have not posted shows a violet **Review draft** tag before its number in the table.
  The table shows up to two reviewers' pictures and lists the rest under `+N`; with no reviewer, an icon shows the review state.
  Click a table row's reviewers to ask someone for a review, or to withdraw a request, from the repository's people, as the details' **Reviewers** field does; with no reviewer and no review state, a muted person icon stands in its place.
  A pick shows at once and goes to GitHub after the ones before it; when GitHub refuses one, the row drops it and a toast says why.
  A merged pull request's reviewers do not change.
  A pull request with more than 100 review conversations shows the count among the first 100 with a `+`, for example `12+ open threads`.
  A **Reply** row or card also shows who started its open threads: a sparkles icon with how many a bot started, such as Cursor Bugbot, CodeRabbit, or Copilot, and a person icon with how many people started.
  Its tooltip says so in words, and adds that it counts only the threads GitHub listed when it listed only the first 100.
  The row's `⋯` menu is always visible in the table; in the sidebar it shows while you hover or focus the row, while a session starts on it, or while a change goes to GitHub.
  It holds the quick actions that apply, then **Approve** on an open or draft pull request you did not open, **Convert to draft** on an open pull request or **Ready for review** on a draft, the **Reviewers** submenu, and **Close pull request**, then **Open on GitHub**; a merged pull request offers no state change and no **Reviewers**.
  **Explain this PR** and **Ask a question** follow the quick actions: each opens New session, in the pull request's checkout when it has one, with a draft you still send.
  **Approve** posts an approval with no summary at once, and the list is read again after GitHub takes it; it is gone while your latest review approves the pull request.
  **Reviewers** lists the repository's people, read from GitHub when it first opens, each with their picture and name as the details' **Reviewers** field shows them, with a check on each one asked for a review; choose one to ask them or withdraw the request.
  Right-click a row or a card, or focus its title and press the context-menu key or Shift+F10, for the same menu.
  On your own open pull request without merge conflicts whose base has commits its branch lacks, **Rebase on main**, named after its base, follows the quick actions.
  It rebases the branch on its base from the repository's most recently used workspace, runs the repository's pre-push checks, and pushes the branch with `--force-with-lease`.
  One rebase runs at a time, so the item reads **Queued to rebase** behind another one, then **Rebasing** beside a spinner until the push ends, which can take minutes.
  A toast with a spinner and a running clock follows it at once: `Rebasing me/fix on main`, with how many rebases it waits behind, then the step the server is on: `Reading the pull request`, `Waiting for another rebase in this repository` while another rebase of the same repository runs, `Fetching main and me/fix`, `Rebasing onto main`, and `Pushing through the pre-push checks`, the long one.
  When it ends, the same toast says what came of it: the rebase, a branch that already had its base, or the server's reason for refusing, such as uncommitted changes in the workspace, local commits the pull request lacks, or failed checks.
  When the rebase stops at a conflict, the toast counts the conflicting files and names the first three, and a **Resolve conflicts** session starts on the pull request, as its quick action does.
  The list reads GitHub again once the rebases end.
  A state change, a review request, or a merge from a row shows in the list as soon as GitHub takes it, and the list then reads GitHub again; a closed pull request leaves the list, and when GitHub refuses a change, a toast says why.
  Click a **Review**, **Fix CI**, **Rebase**, or **Reply** badge to start its quick action when available, such as **Resolve conflicts** for **Rebase**.
  A fix's badge tooltip ends with **Send to** and the name of the session its row lists first, the one the fix most likely goes to, as the quick actions paragraph below says; a **Your move** row whose fix no session worked on reads **no session**, and its badge's tooltip ends with **New session**.
  While a quick action's session starts on a pull request, from its badge or its `⋯` menu, or while its rebase is queued or runs, the badge reads **Starting**, **Queued**, or **Rebasing** beside a spinner, and its tooltip says what, such as **Starting Fix CI**.
  Click a **Merge** badge for a popover that reads the pull request from GitHub and confirms the merge; a **CI running** badge on your own pull request that is ready but for its checks opens it too, and queues the merge until they pass.
  Click a repository or a section heading to fold it; the app keeps your choice across reloads.
  A folded section's heading shows its count, and its tooltip sums up its moves, such as `2 in review · 1 CI running`.
  A repository's heading names its workspaces only when their folder differs from the repository's name, and an unplugged icon in the header lists the workspaces whose repository could not be read.
  **Waiting on others** and **Recently merged** start folded, since they hold nothing to do now, and stay unfolded once you unfold them.
  Click the row to show the pull request's details docked at the right of the table, with the row highlighted; session chips, move badges, the reviewers, and the `⋯` menu keep their own clicks.
  Drag the details' left edge to resize them, or focus it and press ← or →, with Shift for larger steps; double-click it to reset the width, which the app keeps.
  The title remains a link for keyboard and modifier-click navigation.
  **Open as a page** in the docked details shows them on a page of their own, on the tab they showed, and the close button hides them.
  The app keeps that choice, so the next pull request you open shows as a page too, until the back arrow at the start of the page header, **Back to Pull requests**, brings the list back with the details docked beside it.
  Click a session to open it.
  The dashboard reads GitHub through `gh` when it loads and every minute after, on every page, so the **Pull requests** tab's count stays current.
  Reopening the Pull requests page, even after a reload, shows the last pull request list read for the chosen workspace at once; the top of the list says when that list was read, and the app keeps the last one of each workspace.
  The server keeps each repository's answer for 30 seconds, and the refresh button asks GitHub again at once.
  While fewer than 1000 of your GitHub token's hourly GraphQL points are left, which your agents' `gh` calls share, the list stops asking GitHub and says `Cannot refresh pull requests: GitHub quota low until HH:MM`, keeping the list it has until the quota resets; details you open, and every change you make, still go to GitHub until the quota is spent.
  A pull request's details open on **Summary**.
  A session's **PRs** sidebar shows the session's first pull request, and its **Summary** and stack menu show another there in its place, without changing the page.
  While the Pull requests page shows a PR, Cmd+Shift+K copies its `#N` and Cmd+Shift+, copies its GitHub link.
- **Rebase N behind** at the top of the Pull requests page shows while N of your pull requests can rebase on their base, counting the ones stacked on them.
  The first click arms **Confirm rebase of N?**, and a second click within three seconds rebases them one at a time, as **Rebase on main** does, the bottom of each stack first.
  A pull request stacked on one whose rebase stopped at a conflict or failed is skipped, even when a **Rebase on main** click queued that one before.
  One toast with a spinner and a running clock counts the run, such as `Rebasing 2 of 5 pull requests`, and names the branch rebasing now with its step, such as `me/fix: Pushing through the pre-push checks`; when the last one ends, it sums up the run, such as `Rebased 3 of 5 pull requests`, with how many already had their base, stopped at a conflict, failed, or were skipped.
  A conflict or a failure also toasts on its own as it happens.
  The button reads **Rebasing…** beside a spinner and waits while any rebase is queued or running.
- A **Your move** table's heading ends with one button per fix its pull requests wait on, such as **Reply 3**, **Fix CI 2**, and **Rebase 1**, counting those with no session starting.
  The first click arms **Confirm N?** followed by how many pull requests list a session and how many list none, such as **Confirm 4? · 3 to sessions, 1 new**, and a second within three seconds runs the move's quick action on each of them, as clicking each row's move badge does: **Address comments**, **Fix CI**, and **Fix CI and conflicts** or **Resolve conflicts**, each sent to the session that owns its pull request, else in a new session per pull request.
- Tabs above the list show part of it: **Open** every section but **Recently merged**, **Your move**, **Approved**, and **Merged** that one section, and **All**, the default, every section.
  A tab reads as picked only while the sections shown are exactly its own, so sections you switch one by one leave no tab picked.
- **Filter**, the funnel at the end of the tabs' row, has a submenu per field: **Section** lists the sections, **Repository** and **Author** list their values with how many pull requests each holds, and **Created** and **Updated** keep the pull requests from the last day, 3 days, week, 2 weeks, or month.
  A repository or author you checked that lists nothing now, such as a repository you hid since, stays in its submenu with none, so you can uncheck it.
  Each field you set adds a chip under the tabs, such as **Author is MaisonnatM** or **Repository is any of 2 repositories**, whose tooltip names them; click the value to change it, or its × to drop the field, and **Clear all** drops every field once two chips show.
  After a × the focus moves to the next chip's ×, or the previous one's, or **Filter** when no chip is left, and after **Clear all** to **Filter**; the Notifications bar does the same.
  The last section shown stays on.
  The author, date, and search filters apply before stacks join, so a stack keeps only the pull requests that match.
  While any filter or search is set, a repository with nothing left leaves the page, unless **Show empty sections** in **Display** is on; when nothing is left, a note names the search or the filters with a button that clears them and moves the focus to the list.
  The filtered pull requests leave the table and ↓ and ↑; **Rebase N behind** and the **Pull requests** tab's count still cover them.
  The browser keeps the filter across reloads.
- The search field in the page header keeps the pull requests whose title, number, branch, author, or repository contain every word you type; Escape clears it.
  The page forgets the search when you leave it.
- **Display**, the sliders button beside **Filter**, holds **Grouping**, **Ordering**, **Show empty sections**, and **Repositories…**; it stays highlighted while you hide a repository.
  **Grouping** lays the list out by **Repository**, the default, by **Section** with a table per repository under each section, by **Author**, most pull requests first, with a table per section under each author, or with **No grouping**, one table of every pull request, in section order.
  Every grouping but **Repository** folds its own headings and keeps no drag; **Waiting on others** and **Recently merged** start folded there too.
  **Ordering** orders the pull requests within each section: **Recently updated**, the default, **Newest first** and **Oldest first** by number, or **Manual**.
  Any order but **Manual** keeps your moves in their order and sorts within each move.
  Drag a pull request within its section to place it by hand, which switches the order to **Manual** and keeps the order the section showed until then.
  In **Manual**, a pull request you never placed comes first, most recently updated first.
  A stack moves as one, and its pull requests keep their order from the top of the stack.
  Drag a repository's name on the page to reorder the repositories, and a section's heading on the page to reorder the sections, which applies to every repository.
  Alt+Shift+↑ and ↓ move the focused pull request, section heading, or repository name one place, as dragging does.
  The app keeps the order across reloads, and **Reset the order** under **Ordering** restores the default.
- **Repositories…** in **Display** lists every repository the page covers, each with a switch that shows or hides it and buttons that move it up or down.
  Its line under the title says that a hidden repository also leaves the tab's count, and that the browser keeps the choice.
  While you hide any, the **Display** button's tooltip reads **Display: N repositories hidden**.
  A hidden repository leaves the table, **Rebase N behind**, ↓ and ↑, and the **Pull requests** tab's count, and keeps its place in the order, so it comes back where it was.
  E still works on the details of a hidden repository's pull request.
  **Reset the order** leaves the hidden repositories hidden, and the browser keeps the choice across reloads.
  When every repository is hidden, the page says "Every repository is hidden. Show them from Display, then Repositories." above a **Show all repositories** button.
- **+** in the page header opens **New pull request**: pick a workspace, named by its repository and by its folder when the repository has several, say what should change, and **Start** opens a new session there that makes the change on a new branch and opens a pull request for it.
  The session opens in the focused pane, and the New session page keeps its own draft.

- The Pull requests page works from the keyboard, outside text fields, while its tab shows.
  ↓ and ↑ move to the next and previous row, and Enter shows the focused row's details.
  While the details show, ↓ and ↑ show the next and previous pull request; while the **Code** tab shows, they open the next and previous file.
  O opens the focused row's pull request, or the one whose details show, on GitHub, and `.` opens the focused row's `⋯` menu.
  E gives the focused row's move, or the move of the pull request whose details show, to an agent, when a quick action makes that move.
- `#pull-requests/<owner>/<repo>/<number>` shows one pull request's details.
  Beside the table, the page unfolds its row's repository and section, scrolls the row into view, and highlights it.
  When the list does not include that pull request, a note says why, and the details still show.
  `#pull-requests/<owner>/<repo>/<number>/files` opens the details on the **Code** tab at the first file, and `#pull-requests/<owner>/<repo>/<number>/files/<path>` at the file at that path, encoded; choosing **Code** puts that address in the location bar, and another tab takes it out.
- The quick actions in a row's `⋯` menu on the Pull requests page, and buttons in the pull request's details, start a new dashboard session in the background, from the repository's most recently used workspace, with a prompt that names the pull request and its branch.
  An action that changes the branch, every one but **Review** and a **Thermonuclear review** of someone else's pull request, starts the session in a git worktree on the branch: the worktree that has it checked out, else a new one beside the main worktree on the local branch, else on origin's branch, fetched.
  When origin cannot be reached, or the branch is in a fork the workspace's origin lacks, the start fails and the note says why.
  The page stays on screen, and the session shows at once as a chip with its status dot on the row and in the details of that pull request, before it has touched the pull request; click the chip to open the session (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  The chip stays while the session runs, after a reload too, so the row says whether an agent still works on the pull request.
  The session also shows in the sessions sidebar.
  Which actions show depends on the pull request: **Fix CI and conflicts** on your own open pull request with merge conflicts and failed checks, **Fix CI** on your own open pull request whose checks failed, **Resolve conflicts** on your own open pull request with merge conflicts, **Address comments** on your own open pull request with unresolved review threads or requested changes, **Review** on an open pull request that waits for your review, and **Thermonuclear review** on every open or draft pull request.
  **Fix CI and conflicts** rebases the branch and resolves its conflicts first, then fixes the checks that still fail on the rebased branch, in one session.
  Both rebasing actions tell the session how to work through each commit that stops: list its conflicted files, add each one it resolves, take a whole side past a post-checkout hook such as pre-commit's, and continue without an editor.
  **Fix CI and conflicts**, **Fix CI**, **Resolve conflicts**, and **Address comments** go to the session that already owns the pull request instead of a new one: the session running on it gets the fix as a follow-up after its turn, else the session that watches the pull request, or the last session that ran a fix on it, resumes and gets it; only a pull request no such session owns starts a new session.
  These fixes end their session through `end_session` once the fix is pushed, which moves it to the past sessions and removes its worktree, and the next fix resumes it; a session that could not finish, such as one with a failure it could not fix, stays open and says what is left.
  **Review** reviews the pull request's head commit and saves what it finds as the pull request's review draft, through the dashboard's `save_review_draft` tool, which only that session gets, and resumes of it too; it posts nothing on GitHub, and the draft waits on the **Review draft** tab for you to post it.
  A new draft of the same pull request replaces the one before it, findings and edits included, except the comments you added from **Code** on the same head, which stay after the new findings.
  **Thermonuclear review** runs the `thermonuclear-reviewer` agent on the pull request's diff.
  On your own pull request, the session then applies the valid findings on its branch, pushes them, and only after the push adds `- [x] Thermo-nuclear code quality review` to its description; on a pull request you review, it reports the findings in the session and changes nothing on GitHub.
  The button waits while the session starts.
  When the start fails, a note at the top of the Pull requests page, and in the details of that pull request, gives the reason until you dismiss it.
  When another session already works on the same task, the note says which instead, by its name, else its directory: `Cannot start "Review": session "<session>" already works on owner/repo#123.`
  For a session this dashboard runs, in any workspace, **Open session** opens it in the focused pane, and **End it and start again** ends it, waiting while it ends, then starts the quick action again.
  For a session another dashboard runs, the note names that dashboard's port and the session's directory, and offers only **Dismiss**.
