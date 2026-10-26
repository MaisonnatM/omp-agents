# Pull requests

- A session lists the pull requests it submitted or worked on as `#<number>` after its title in the sidebar, and on the pull request button in its header.
  In the sidebar, a session with several shows the first number and `+N` for the rest, for example `#6535 +2`; hover it to read them all, or find each in the row's menu.
  Its subagents' pull requests count as its own.
  A submission is a `gt submit` line (`<branch>: https://app.graphite.com/github/pr/<owner>/<repo>/<number> (created)` or `(updated)`) or the URL a `gh pr create` call printed, both from bash output, including bash run as a background job.
  A stack submit lists every PR it created or updated.
  A `gt submit` or `gt ss` call is a submission too, even when it printed nothing, as with `-q`: of the branch it names with `--branch`, else of the branch checked out where it ran, at the time it ran, in the main checkout too, but not of a `--dry-run`.
  Where it ran follows the bash call's `cwd`, a `cd` earlier in the same command, and `--cwd`; when it ran picks the branch from that worktree's HEAD reflog, so a later switch leaves the link alone.
  Work is one of the session's own tool calls: `gh pr checkout`, `edit`, `comment`, `review`, `merge`, or `ready` with a PR number or URL; a `git push` whose output shows that it updated a PR's head branch; or an omp `pr://` read.
  Work is also the branch the session works on when a PR heads it: the branch checked out in the linked worktree the session works in, its own directory or the worktree its bash calls last ran in, or in a repository's main checkout a branch other than the default one that `origin/HEAD` names; a switch to another branch links that branch's PR at the session's next write.
  A main checkout's default branch links no PR, since every session started there shares it.
  A bare number belongs to the repository that `origin` names in the session's working directory, unless the command passes `-R` or `--repo`.
  A push, a submit, or a worktree's branch links once the Pull requests page has listed the PR that the branch heads, because only that list knows which branch heads which PR.
  A submit links only while the directory it ran in exists.
  A PR the session only quoted, listed with `gh pr list`, or looked up with `gh pr view` does not count, unless it heads the session's worktree branch.
  A PR that a session submitted counts as submitted, even when it also worked on it.
- In a session's header, the pull request button opens a popover with one row per pull request: the row opens its details on the Pull requests page, and the GitHub and Graphite icons at its end open it there.
  When two or more of the session's open pull requests stack on each other, as a ticket's `gt submit` stack does, the button reads **Stack · 3** and the popover draws the stack on a rail, top first, down to the branch it merges into, as a pull request's **Stack** does.
  The session's other pull requests follow under **Also on this session**, and **Open stack on Graphite** ends the popover.
  **Merge stack**, under the rail, merges the whole stack into the bottom one's base, bottom first, after a confirmation with the merge methods the repository allows.
  The dashboard's server merges each one once the one below it merged, retargeting it onto that base, marking a draft ready, and updating its branch as GitHub requires, as a merge that waits until it is ready does; the line under the rail says which one it is on and what it waits on, with **Cancel**.
  It stops at the first one that fails, with the reason, and leaves the ones above it as they are.
- A session's row menu has **Open ENG-2368** for each Linear issue the session worked on, by identifier, and so does the ticket button in its header.
  It opens the issue's details in the tickets page's main content (`#tickets/<identifier>`), and shows the **Tickets** tab's icon.
  An issue counts when the session or one of its subagents read it with omp's Linear tools (`get_issue`, `list_comments`), changed or opened it (`save_issue`), commented on it (`save_comment`), or names it in its `/ship` step.
  An issue that a `list_issues` search only listed does not count.
- Sessions that use `/ship` show their current workflow step in the sidebar, for example `6/7 · Rebase`.
  Hover the badge to see the Linear issue.
  The steps are ticket, implementation, draft PR, thermonuclear review, ready gate, live review, and merged.
  During live review the badge names the active rebase, review-comment, or CI-fix work.
  omp writes each step to its session file; the dashboard reads those entries for running and past sessions and updates when the step changes.
  Other sessions have no workflow badge.
- Seven tabs under the sidebar header, **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, **Inbox**, and **Settings**, switch pages and what the sidebar lists.
  Click a tab or use the left and right arrow keys while a tab has focus to switch pages.
  **Tickets** shows only once Linear is connected; see [Linear tickets](linear-tickets.md).
  **Inbox** shows only once Gmail is connected; see [Inbox](inbox.md).
  **Sessions** lists the running and past sessions, and **Todo** opens your own todo list, with its categories in the sidebar; see [Todo list](todo-list.md).
  The **Sessions** tab counts the live sessions that wait on you, idle after a turn or with a question open, for the workspace that the sidebar's picker shows, pinned ones included, whatever the sidebar's search hides.
  Choosing **Sessions**, by click or by its number, while no pane is open opens the selected workspace's live session started last, else its past session saved last; with a pane open it keeps the panes.
  Closing that session leaves the panes empty until you choose **Sessions** again.
  **Calendar** opens a month of Google events, routine runs, and due todos and tickets, with your routines listed under it; see [Calendar](calendar.md) and [Routines](routines.md).
  The tabs show their names, and when the sidebar is too narrow for every name, their icons alone across the sidebar's width; hover an icon for its name.
  The tabs never spill past the sidebar.
  **Pull requests** opens the Pull requests page, a table of your pull requests like Graphite's inbox, and lists its sections in the sidebar, each with its count; click one to unfold its card on the page and scroll to it.
  Once you open a pull request or a session from the Pull requests page, the sidebar lists the pull requests instead, beside the details or the session panes.
  In the board view, the sidebar lists the board's columns instead, each with its count; click one to unfold the column and scroll to it, while a pull request's details stay docked beside the board.
  The tab stays on **Pull requests** while you open sessions from it, until you choose **Sessions**.
  The **Your move** count stands out in bold.
  The **Pull requests** tab counts the pull requests that wait on your move, for the workspace that the sidebar's picker shows, and reads GitHub every minute on every page so the count stays current.
  A `#pull-requests` address opens the Pull requests page.
  The pull request list covers the GitHub repository of the workspace that the sidebar's picker shows, or under **All workspaces** every repository that a session ran in, one section per repository.
  A workspace's repository is the one its `origin` remote names.
  A directory removed since its sessions ran, such as a deleted worktree, is no longer a workspace, so quick actions start in a workspace that still exists.
  Each repository lists your open pull requests, your merges from the last seven days, and the open pull requests that ask you for a review.
  They sort by whose move it is: **Your move**, **Agent on it**, **Approved**, **Waiting on others**, **Drafts**, and **Recently merged**.
  A sidebar row shows the title on up to two lines with its age beside it, such as `<1m`, `19m`, `17h`, or `2d`, which counts up each minute without a reload, then a badge that names its move, its number, the reason for the move, its place in a stack, its sessions, its conversations, and its checks.
  A badge is coloured only for your moves, each with its own icon and colour, such as red for **Fix CI** and orange for **Rebase**; every other move is grey.
  The Pull requests page's table shows each section as a card, one row per pull request: the move's badge, the title with its author's picture and name, number, conversations, and reason under it, the sessions on it, its place in a stack, its checks, its reviewers or review state, the lines added and removed, its age, and its `⋯` menu at the far right.
  Conversations count the pull request's comments and review threads, resolved ones too, as GitHub's own list does, beside a speech bubble; a pull request with none shows no count.
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
  A running session's chip starts with the sidebar's status dot: green while it works, amber while it waits on a question, blue once its turn ended.
  In the sidebar the chip shows only an agent icon and that dot, with the session's name in its tooltip; the table shows the name.
  `+N` after the chip lists every session on the pull request, each with whether it submitted or worked on it; choose one to open it.
  A pull request whose **Review** session saved a review draft you have not posted shows a violet **Review draft** tag before its number, in the sidebar and in the table.
  The table shows up to two reviewers' pictures and lists the rest under `+N`; with no reviewer, an icon shows the review state.
  Click a table row's or a board card's reviewers to ask someone for a review, or to withdraw a request, from the repository's people, as the details' **Reviewers** field does; with no reviewer and no review state, a muted person icon stands in its place.
  A pick shows at once and goes to GitHub after the ones before it; when GitHub refuses one, the row drops it and a toast says why.
  A merged pull request's reviewers do not change.
  A pull request with more than 100 review conversations shows the count among the first 100 with a `+`, for example `12+ open threads`.
  A **Reply** row or card also shows who started its open threads: a sparkles icon with how many a bot started, such as Cursor Bugbot, CodeRabbit, or Copilot, and a person icon with how many people started.
  Its tooltip says so in words, and adds that it counts only the threads GitHub listed when it listed only the first 100.
  The row's `⋯` menu is always visible in the table; in the sidebar it shows while you hover or focus the row, while a session starts on it, or while a change goes to GitHub.
  It holds the quick actions that apply, then **Convert to draft** on an open pull request or **Mark ready for review** on a draft, the **Reviewers** submenu, and **Close pull request**, then **Open on GitHub** and **Open on Graphite**; a merged pull request offers no state change and no **Reviewers**.
  **Reviewers** lists the repository's people, read from GitHub when it first opens, with a check on each one asked for a review; choose one to ask them or withdraw the request.
  Right-click a row or a card, or focus its title and press the context-menu key or Shift+F10, for the same menu.
  On your own open pull request without merge conflicts whose base has commits its branch lacks, **Rebase on main**, named after its base, follows the quick actions.
  It rebases the branch on its base from the repository's most recently used workspace, runs the repository's pre-push checks, and pushes the branch with `--force-with-lease`.
  One rebase runs at a time, so the item reads **Queued to rebase** behind another one, then **Rebasing…** until the push ends, which can take minutes.
  A toast says what came of it: the rebase, a branch that already had its base, or the server's reason for refusing, such as uncommitted changes in the workspace, local commits the pull request lacks, or failed checks.
  When the rebase stops at a conflict, a toast counts the conflicting files and a **Resolve conflicts** session starts on the pull request, as its quick action does.
  The list reads GitHub again once the rebases end.
  A state change, a review request, or a merge from a row shows in the list as soon as GitHub takes it, and the list then reads GitHub again; a closed pull request leaves the list, and when GitHub refuses a change, a toast says why.
  Click a **Review**, **Fix CI**, **Rebase**, or **Reply** badge to start its quick action when available, such as **Resolve conflicts** for **Rebase**.
  Click a **Merge** badge for a popover that reads the pull request from GitHub and confirms the merge; a **CI running** badge on your own pull request that is ready but for its checks opens it too, and queues the merge until they pass.
  Click a repository or a section heading to fold it; the browser's localStorage keeps your choice across reloads.
  A folded section's heading shows its count, and its tooltip sums up its moves, such as `2 in review · 1 CI running`.
  A repository's heading names its workspaces only when their folder differs from the repository's name, and an unplugged icon in the header lists the workspaces whose repository could not be read.
  **Waiting on others** and **Recently merged** start folded, since they hold nothing to do now, and stay unfolded once you unfold them.
  Click the row to show the pull request's details in the main area; session chips, move badges, the reviewers, and the `⋯` menu keep their own clicks.
  The title remains a link for keyboard and modifier-click navigation.
  The back arrow at the start of the page header, **Back to Pull requests**, brings the Pull requests page back.
  Click a session to open it.
  The dashboard reads GitHub through `gh` when it loads and every minute after, on every page, so the **Pull requests** tab's count stays current.
  Reopening the Pull requests page, even after a reload, shows the last pull request list read for the chosen workspace at once; the top of the list says when that list was read, and the browser's localStorage keeps the last one of each workspace.
  The server keeps each repository's answer for 30 seconds, and the refresh button asks GitHub again at once.
  A pull request's details open on **Summary**.
  A session's **PRs** sidebar shows the session's first pull request, and its **Summary** and stack menu show another there in its place, without changing the page.
  While the Pull requests page shows a PR, Cmd+Shift+K copies its `#N` and Cmd+Shift+C copies its GitHub link.
- **Rebase N behind** at the top of the Pull requests page shows while N of your pull requests can rebase on their base, counting the ones stacked on them.
  The first click arms **Confirm rebase of N?**, and a second click within three seconds rebases them one at a time, as **Rebase on main** does, the bottom of each stack first.
  A pull request stacked on one whose rebase stopped at a conflict or failed is skipped, even when a **Rebase on main** click queued that one before.
  Each rebase, conflict, and failure toasts as it happens, and a last toast sums up the run, such as `Rebased 3 of 5 pull requests`, with how many already had their base, stopped at a conflict, failed, or were skipped.
  The button reads **Rebasing…** and waits while any rebase is queued or running.
- The sort button at the top of the Pull requests page orders the pull requests within each section: **Recently updated**, the default, **Newest first** and **Oldest first** by number, or **Manual**.
  Any sort but **Manual** keeps your moves in their order and sorts within each move.
  Drag a pull request within its section to place it by hand, which switches the sort to **Manual** and keeps the order the section showed until then.
  In **Manual**, a pull request you never placed comes first, most recently updated first.
  A stack moves as one, and its pull requests keep their order from the top of the stack.
  Drag a repository's name on the page or in its sidebar index to reorder the repositories, and a section's heading on the page to reorder the sections, which applies to every repository.
  Alt+Shift+↑ and ↓ move the focused pull request, section heading, or repository name one place, as dragging does.
  The browser's localStorage keeps the order across reloads, and **Reset the order** in the sort menu restores the default.
- **List** and **Board** at the top of the Pull requests page switch its view, and the browser's localStorage keeps the choice.
  The board shows a column per section, in the sections' order, each holding the pull requests of every repository as cards: the move's badge, state, and age, the title, the repository and number with the reason, then the sessions, stack, conversations, checks, reviewers, and lines added and removed.
  The repository shows on a card only when the board spans more than one.
  **Recently merged** starts folded; click a column's title to fold it to a narrow strip with its count, and click the strip to unfold it.
  An empty column is a strip too, and every strip still takes a drop.
  Drag a card onto another column to run the step that moves it there.
  The card follows the pointer, and the column under it shows a dashed slot named after the step, or turns red and says why no step applies.
  **Agent on it** starts the quick action of the card's move, such as **Fix CI** with an agent.
  **Recently merged** opens the card's merge confirmation, for a pull request that is **Merge**, or **CI running** and ready but for its checks; the merge happens only once you confirm it.
  **Drafts** converts your open pull request to a draft, and **Your move**, **Approved**, or **Waiting on others** marks your draft ready for review.
  Every other column fills from GitHub, so a drop there is refused, as is one on a merged pull request or on someone else's draft state.
  A refused drop, Escape, or a release outside the columns springs the card back.
  Space on a focused card's title picks it up, ← and → choose its column, Space or Enter drops it, and Escape or Tab puts it back; a screen reader hears each step.
  Click a card to show the pull request's details docked at the right of the board, with ↓ and ↑ stepping through the cards column by column.
  **Open as a page** in the docked details switches to the list view with the details on their own page, and the close button hides them.

- The Pull requests page works from the keyboard, outside text fields, while its tab shows.
  ↓ and ↑ move to the next and previous row, and Enter shows the focused row's details.
  While the details show, ↓ and ↑ show the next and previous pull request; while the **Code** tab shows, they open the next and previous file.
  The sidebar's pull request list, which stays while you work in the sessions, takes ↓ and ↑ only once one of its rows has focus, so they keep scrolling a session.
  O opens the focused row's pull request, or the one whose details show, on GitHub, and `.` opens the focused row's `⋯` menu.
  E gives the focused row's move, or the move of the pull request whose details show, to an agent, when a quick action makes that move.
- `#pull-requests/<owner>/<repo>/<number>` shows one pull request's details.
  The sidebar unfolds its row's repository and section, scrolls the row into view, and highlights it.
  When the list does not include that pull request, a note says why, and the details still show.
  `#pull-requests/<owner>/<repo>/<number>/files` opens the details on the **Code** tab at the first file, and `#pull-requests/<owner>/<repo>/<number>/files/<path>` at the file at that path, encoded; choosing **Code** puts that address in the location bar, and another tab takes it out.
- The quick actions in a row's `⋯` menu on the Pull requests page, and buttons in the pull request's details, start a new dashboard session in the background, in the repository's most recently used workspace, with a prompt that names the pull request and its branch.
  The page stays on screen, and the session shows at once as a chip with its status dot on the row and in the details of that pull request, before it has touched the pull request; click the chip to open the session (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  The chip stays while the session runs, after a reload too, so the row says whether an agent still works on the pull request.
  The session also shows in the sessions sidebar.
  Which actions show depends on the pull request: **Fix CI and conflicts** on your own open pull request with merge conflicts and failed checks, **Fix CI** on your own open pull request whose checks failed, **Resolve conflicts** on your own open pull request with merge conflicts, **Address comments** on your own open pull request with unresolved review threads or requested changes, **Review** on an open pull request that waits for your review, and **Thermonuclear review** on every open or draft pull request.
  **Fix CI and conflicts** rebases the branch and resolves its conflicts first, then fixes the checks that still fail on the rebased branch, in one session.
  **Review** reviews the pull request's head commit and saves what it finds as the pull request's review draft, through the dashboard's `save_review_draft` tool, which only that session gets, and resumes of it too; it posts nothing on GitHub, and the draft waits on the **Review draft** tab for you to post it.
  A new draft of the same pull request replaces the one before it, findings and edits included, except the comments you added from **Code** on the same head, which stay after the new findings.
  **Thermonuclear review** runs the `thermonuclear-reviewer` agent on the pull request's diff.
  On your own pull request, the session then applies the valid findings on its branch, pushes them, and only after the push adds `- [x] Thermo-nuclear code quality review` to its description; on a pull request you review, it reports the findings in the session and changes nothing on GitHub.
  The button waits while the session starts.
  When the start fails, a note at the top of the Pull requests page, and in the details of that pull request, gives the reason until you dismiss it.
