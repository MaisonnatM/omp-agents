# Pull request details

- A pull request's header starts with its repository and a state-colored `#number` link to GitHub.
  Its **Check out** menu, primary action, and `⋯` menu sit at the right.
  Below them are the title, author, last update, copyable `gh pr checkout <number>` command, branches, file count, and lines added and removed.
  Hover the title for **Edit title**, or focus its pencil with the keyboard.
  Enter saves the title and Escape cancels the edit.
  Clicking the head branch copies its name and removes the linked worktree that has it checked out, as a session header's branch does.
  A stacked base is amber.
  When GitHub reports that the branch is behind its base, the base turns orange and gains a warning icon.
  Hover or activate the warning for the commit count and **Update branch** or **Update with rebase**.
  Tab reaches both update actions; Escape closes the popover and returns focus to the warning.
  **Check out** offers **In a separate worktree** and **In this repository**, for the checkout of the pull request's repository that the details know from a session or the selected host.
  With no such checkout, both items are off and say why.
  **In a separate worktree** fetches the head into a local branch of the same name, or `pr-<number>/<branch>` for a fork's head, adds a worktree for it beside the repository, and opens a new session there that sums up the pull request.
  A linked worktree that already has the branch is reused as it is, and one in the main checkout is refused.
  **In this repository** runs `gh pr checkout <number>` in that checkout, and refuses while tracked files have uncommitted changes.
  A toast follows the checkout, and warns when the branch is not at the pull request's latest commit, as a reused branch with local commits is not.
  The primary control shows **Merged** or **Closed** for a finished pull request, **Resolve conflicts** for conflicts, and **Ready for review** for a draft.
  Otherwise it offers the selected merge method, such as **Squash and merge**, or that method **when ready** while GitHub holds the merge.
  The first click arms **Confirm merge?**, and a second click within three seconds sends the merge to the server.
  Escape, blur, or a click outside disarms it.
  The merge is pinned to the head commit the header showed.
  The server updates a stale branch, waits for checks and reviews, and merges once GitHub allows it, even with the page closed.
  The armed merge shows **Auto-merge** with its method, or **Merge stopped** after a failure.
  Its tooltip says what it waits on or why it stopped.
  The `⋯` menu offers **Cancel merge when ready** or **Dismiss stopped merge**.
  Rows keep their popover confirmation and **Queued** or **Stopped** badge.
  The server keeps merges in `merges.json` beside its access token and resumes them after a restart.
  The `⋯` menu starts with the quick actions, including fixes for CI, conflicts, and review comments.
  On your own open pull request without conflicts that the Pull requests page lists as behind its base, **Rebase on main**, named after its base, follows them, as in a row's `⋯` menu, and the details read the pull request again once it ends.
  Next come the merge methods, **Ready for review** or **Convert to draft**, links to GitHub and Graphite, **Copy link**, and **Copy PR number**.
  A method picked there applies to this pull request's merge button; **Last selected** in Settings remembers it only once you confirm a merge with it.
  **Close pull request** or **Reopen pull request** comes last and asks for a second click, with the same disarm behavior as merging.
  The header condenses after the details scroll beyond its expanded body and expands again at the top; scrolling the file list or a diff inside **Code** leaves it as it is.
  In a narrow panel, action labels hide but their tooltips and accessible names remain.
- Under the header, a compact segmented control splits the details into **Summary**, **Timeline**, **Code**, and **Review draft** while a review draft is kept.
  Tabs have no count badges; their accessible names still include timeline and pending-finding counts.
  Left and Right arrow keys select adjacent tabs, and Home and End select the first and last.
  Where the details are narrower than 480 px, as in the sidebar at its default width, each tab shows its icon alone and names itself in a tooltip.
  The tab bar's right end sums up the head commit's checks, such as `1 of 3 running`, `2 of 5 failing`, `15 of 25 passing`, `All checks passed`, or `No checks reported`.
  Only successful checks count as passing, not skipped ones.
  Click the status icon to open the checks popover: checks needing attention come first, then running checks, then completed checks.
  **Show all** reveals completed checks when other checks are failing or running, and **Show less** hides them again.
  Each row names its status and links to the check run through **Details** when GitHub provides a link.
  In a narrow panel the checks label hides, but the status icon's accessible name keeps the summary.
- **Summary** starts with the pull request's reviewers and labels.
  **Reviewers** shows overlapping avatars, each with the dot the pull request list marks a review's outcome with, or **None**.
  Click the row for the people who can review on the repository, with the author left out, each shown with their picture and GitHub profile name, then their login; someone with no profile name shows only their login.
  Type part of a name or a login to filter them.
  Picking a person requests a review, again when they reviewed already, and picking someone already requested withdraws the request.
  **Labels** shows the labels in their GitHub colors; click them for the repository's labels, and pick one to add or remove it.
  The lists of reviewers and labels come from GitHub on the first click of either picker, and the server keeps them for 5 minutes.
  A change shows at once and goes to GitHub in turn after the ones before it; when GitHub refuses one, the details undo it, keep the changes made after it, and say why above the tab.
  The header's linked-sessions count opens a small list of the running sessions on the pull request, each opening through the usual session action.
  When another open pull request stacks with it by base branch, the header's **N/M** menu shows the stack top first on a rail and marks the current layer.
  The menu is the session header's stack popover, with **Merge stack**, the session's other pull requests, and the GitHub and Graphite links.
  The server reads the repository's open pull requests for it and keeps them for 30 seconds.
  **Description**, **Checks**, and **Comments** are collapsible sections with sticky headings.
  **Checks** starts collapsed and says **No checks reported.** when empty; otherwise it lists them as the tab bar's checks popover does, failing and running ones first, with each check's **Details** link.
  The pencil on **Description** opens a textarea with **Save** and **Cancel**; Escape cancels, and a failed save keeps the draft.
  Descriptions and comments render GitHub alerts, issue-number and full-commit autolinks, inline-code chips, attachment cards, and authenticated GitHub images and videos.
  Session transcripts keep their existing Markdown rendering.
- **Comments** inside **Summary** mixes review threads, comments, and review verdicts in cards, newest first, showing ten conversations at a time.
  **Filter comments** toggles **Bot comments** and **Resolved or dismissed**, both hidden by default and remembered in this browser.
  Images in the description and comments load through the app from GitHub's hosts; an image from any other host, or one that fails to load, shows as a link.
  **Newest first** flips to **Oldest first** within the recent conversations shown; **Show older conversations** adds ten more.
  Resolved threads and dismissed reviews start folded.
  **Resolve** resolves a thread and **Unresolve** opens it again, each shown only when GitHub lets you; a refused change is undone.
  A thread you can reply to has a reply box: **Reply**, or Cmd+Enter, Ctrl+Enter elsewhere, sends it, and a refusal keeps the draft.
  Replies go to GitHub as written, up to its 65536 characters, and the details then read the pull request again.
- The round button at the bottom right of the details on the Pull requests page opens the composer, shown only when GitHub lets you comment; a session's **PRs** sidebar has none.
  Its badge counts the Review draft's pending findings.
  **Comment** posts a comment; **Close with comment** asks **Confirm close?** and then posts the comment and closes the pull request, and a closed one offers **Reopen with comment**.
  **Review (N)**, offered on an open or draft pull request, picks **Comment**, **Approve**, or **Request changes**, the last two not on your own pull request, and a summary; **Submit review** accepts every pending finding of an open Review draft and posts it, or posts the review alone.
  An approval needs no summary, a change request needs one, and a comment needs one or a pending finding.
  The trash button dismisses the pending findings, and closing the composer keeps what you typed.
- **Timeline** puts the pull request's activity on a vertical rail, newest first, with avatars for conversations and commits and icons for opened, merged, and closed events.
  Consecutive comments and commented reviews fold into conversation groups showing their comment and author counts.
  Reviews show their verdict and words, with verdicts from before the latest commits muted.
  Each commit shows its short hash, time, and lines added and removed; clicking it opens that commit on GitHub.
  The pull request's own commits show, not those of its trunk that its branch took in; a commit counts as its own unless GitHub links it only to other pull requests.
  Review threads include resolved ones, with resolved and dismissed threads folded initially and outdated threads marked.
  The file and line link to the **Code** tab, and **more replies** reveals the loaded replies in place.
  When a thread has more than the 20 comments loaded, **View on GitHub** opens the rest there.
  A red **New** line sits under what happened since you last opened the pull request's timeline in this browser, which its localStorage keeps for 30 days.
  Above the rail are the comment count the tab shows, the commit count, and the count of reviewers whose latest verdict approves the newest commit, and **Newest first**, which flips the order without reversing replies within a thread.
- **Code** shows every changed file with omp's diff renderer and a T3-style toolbar, on the page and in the sidebar.
  **All commits** selects the whole pull request or one commit.
  The toolbar counts **N of M viewed** and offers **Hide whitespace changes**, **Stacked diff view**, **Split diff view**, **Wrap lines**, **Collapse all files**, **Expand all files**, and the file tree toggle.
  View preferences persist in this browser; narrow panels put layout, wrapping, and whitespace under **Diff options**.
  Files read in source dependency order, then tests in their sources' order, then generated files.
  The tree stays alphabetical, and ↓ and ↑ follow the diff's reading order.
  Each file's **Viewed** checkbox reads and writes your GitHub viewed state; marking it collapses its diff.
  **Changed** means GitHub reports a push since the file was viewed.
  A failed write restores the previous checkbox and says why.
  Renames show **R**, and binary or very large files say why no diff is available.
  In **All commits**, click a line number, optionally Shift-click another on the same side for a range, then **Add comment**.
  **Add to review draft** saves a pending finding locally, without posting to GitHub; Cmd+Enter or Ctrl+Enter saves, and Escape cancels the editor.
  Open **Review draft** to accept, edit, dismiss, or post the finding.
  A posted draft or one for an older head must be discarded before adding another comment.
  A selected commit that leaves the pull request falls back to **All commits**.
- **Review draft** holds findings from a **Review** session and comments added from **Code**, for you to post as your review.
  It says which commit the session reviewed; when the pull request moved on since, a warning names both commits, and the draft cannot post until a new **Review** session saves a draft of the new head.
  **Verdict** picks **Comment**, **Approve**, or **Request changes**, and **Summary** holds the review's words, kept once the field loses focus.
  **Findings** lists one card per issue the session found, under the file and line it is on, each **Pending** until you **Accept** or **Dismiss** it, which **Unaccept** and **Restore** undo; **Accept N pending** accepts every pending one, and **Edit** changes a finding's file, line, and words.
  **Preview** shows exactly what posting sends: the verdict, the body, and each line comment.
  An accepted finding on a line the diff shows becomes a comment on that line; one on another line, or on no line, joins the body as a list item after the summary, since GitHub takes comments only on lines its diff shows.
  **Post review** reads the pull request again and asks you to confirm, naming the verdict, the count of line comments, and the commit; **Post review** there sends one review on the commit the session reviewed.
  It refuses when the pull request moved on, when nothing is accepted and the summary is empty unless it approves, and when **Request changes** has no summary.
  Once posted, the tab says when, links to the review on GitHub, and takes no more changes; posting again, even after a lost answer, never posts a second review, since the server first looks for the review it would post among yours on that commit.
  **Discard draft** deletes the draft, posted or not.
  The server keeps the drafts in `review-drafts.json` beside its access token, and drops a posted draft two weeks after it posted, the next time a session saves a draft.
- Each opening reads the pull request again; the server keeps its answer for 30 seconds.
