# Transcripts

Every transcript comes from the session files on this machine, not from a network connection:

- One recursive file watcher covers each session format's root: omp's sessions directory, Claude Code's `projects` directory under `CLAUDE_CONFIG_DIR` (else `~/.claude`), and Codex's `sessions` directory under `CODEX_HOME` (else `~/.codex`).
  The server makes omp's directory when it is missing; a missing Claude Code or Codex directory is left alone and watched from the first rescan that finds it.
  When a file changes, every open transcript in that directory reads the bytes appended since its last read and folds the complete JSONL lines into display items.
  On macOS a burst of appends can surface only as events for omp's `.<file>.lock` sidecar, which is why a change anywhere in a directory re-reads every open transcript in it.
- A session's transcript is its `<time>_<session id>.jsonl` file.
  A subagent's transcript is `<id>.jsonl` in its parent's artifacts directory, which is the parent's transcript path without `.jsonl`.
  A subagent that outlived a `/new` or `/resume` wrote beside the session it started in, so when the expected file is missing the server looks for the newest `<id>.jsonl` in the project's sessions that changed after the subagent registered.
- A past session reads the same way, so a session that runs without publishing itself keeps updating.
- A Claude Code or Codex session reads the same way, read-only.
  `src/session-formats.ts` holds one `SessionFormat` per agent, and the format whose root holds a file decodes each of its lines into the omp entries the transcript already folds, so the tail, the conversation search, and the past list need no other path.
  A Claude Code session is `<project>/<session id>.jsonl`; its `isMeta` and sidechain records, its bookkeeping records, and its system records other than a compaction are left out, and its tool results become `toolResult` entries.
  A Codex session is `<year>/<month>/<day>/rollout-<time>-<session id>.jsonl`; its developer messages, the context Codex injects as a user message, its events, and its turn context are left out, and a renamed session takes its title from `session_index.jsonl`, the last line for an id winning.
  A Codex session whose `session_meta` names a parent agent is a subagent's, and the past list leaves it out; so does Claude Code's `subagents` directory, which sits one level deeper than a session.
  An unknown or malformed record or content block shows as one warning notice per line with the line's start, alongside any recognized content.
  Intentional empty blocks, injected context, ignored metadata, and encrypted reasoning without readable text do not warn.
  Correlated tool calls require call ids, names, and input; tool results require their call ids, and Codex function namespaces qualify tool names.
  The past row and the pane name the agent, the pane reads `Read-only`, and neither offers **Resume** nor fork buttons; `src/server/start.ts` refuses a fork or a resume of such a file before it starts omp.
  Listing reads only each file's first 256 KB and last 64 KB, and a file whose size and modification time are unchanged keeps its row.
- Live agent events only add what the file does not hold yet: the reply as it streams, and the running state of tool calls.
  omp keeps a message's `timestamp` when it writes the message, so the file's copy replaces the streamed copy in place, and a late event cannot undo it.
  omp writes a fresh session's file only with its first reply.
  Until then the prompt shows from its live event, except a prompt sent from the dashboard to a terminal session, whose file entry has no message timestamp to merge on.
  A `/skill:` prompt is a `custom` message of type `skill-prompt`, and omp writes its `custom_message` entry with the message's timestamp, so it merges on that.
  A queued steer or follow-up keeps the time it was sent, though the agent takes it later.
  So a message from the file never goes ahead of the file messages before it, and a live user message goes after everything already shown.
  A message that arrives older than items already shown, such as a prompt that reaches the file only after its streamed reply, goes after the last item at or before its time.
  Its `items` message lists it and every item after it, in order, and lists those it displaced in `removed` too, so the page drops them and appends them again in one update rather than taking the whole list.
- A reply that streams and a tool call that runs change with every token.
  Each open transcript sends those changes to the page at most every 50 ms; a message that finishes, a tool call that ends, a prompt, or a notice goes out at once, together with what was held back.
  A live event waits for a read of the file first, so the file's copy of a message it settled wins, but asks for a read at most once per 50 ms; the events in between wait for that read, and the watcher reads each later write.
- A dashboard session's view shows a prompt that omp admitted while the main agent was idle as a pending user item, after every other item, until the turn's live user message replaces it ([Dashboard sessions](dashboard-sessions.md)).
  It renders as that message will: a `/skill:` prompt as the skill and its arguments, attached files by name, images inline.
  Its id is `starting:<request id>`, and the `items` message that brings the live user message lists that id in `removed`, so the page drops it and appends the real prompt in one update.
  Besides a pending prompt, only the items a message displaced are in `removed`, and the same message brings them back, so `removed` is empty in every other `items` message.
- A user message whose text starts with `[omp-agents]` (`DASHBOARD_PROMPT_PREFIX` in `src/shared/transcript.ts`), as an older version's project updates did, is a prompt the dashboard sent in the user's place.
  The transcript folds it into a `dashboard` item, never a pending one, which the page renders as nothing but counts as a turn's prompt: the reply before it keeps its copy and fork buttons, the user's prompt before it is no longer the editable last prompt, and a reply before it suggests nothing.
  `messageItemsOf` leaves it out, so the conversation search skips it and the trajectory folds it as an `omp-agents` injection into the turn before it; it titles no session, neither through the `/rename` a dashboard session sends after its first prompt nor as a past session's first prompt, and the composer's queued rows leave it out.
- The same read folds each line into the view's changed files as well, from each `edit` result's `details.path` and `diff` (one per entry of `perFileResults` for a multi-file edit) and each `write` result's `details.resolvedPath`, which omp sets only for a file.
  The view's socket topic carries them as `work` messages: the whole list with the transcript, then only the files each later read changed, which the page puts in place by path.
  A subagent's view folds its own file, so it shows its own changes.
- A `task` result names the subagents it spawned in `details.progress` and `details.results`; the tool item lists their ids, which name each subagent's view.
  A running `task` reports them sooner through `tool_execution_update` events.
- A tool result's images, through `imagesOf` in `src/session-entries.ts` as a prompt's, ride on its tool item as `images`, which the transcript shows under the call's row; only the view's own file adds them, while the media tree below also collects its subagents'.
- Each watched view also gets a media tree (`src/media.ts`), which collects the images that tool results returned, from the view's file and from every subagent transcript, at any depth, in the directory named after it.
  About half the screenshots in a session sit in its subagents' files, so a session's view collects them all; a subagent's view collects its own and its subagents'.
  An image is a `content` block of a tool result, which omp moves to its blob store, so it reaches the page through `/api/image`; the caption is the summary of the tool call with the same id, and a user prompt's images are left out.
  It also collects image files the session wrote, as `AgentMedia` with `path` set and a `src` of `/api/media?path=`: each path ending in an image extension in a tool call's string arguments, at any depth, or in its result's text, resolved against the call's `cwd` argument, else the session's `cwd` from its header.
  A named file counts as written when `stat` finds a regular file modified at or after the `timestamp` of the tree's own session header, which leaves out paths in source code and files that predate the session.
  The tree keeps each check with the time it ran, and checks a path again when a later call names it, since a script may write a file after a call lists it.
  A `read` of an image file sets that path on the image it returned, and each path shows once across the tree: its oldest entry, and none for a path the list already holds.
  It reads each file incrementally, parses only lines holding a tool call, an image block, a path to an image file, or the session header, and reads a tool result's call id without parsing the result, so a caption is dropped once its result arrives, unless the call named an image file; it lists the directory again, reading the subagent files at once, after each change under it, so a subagent that starts later is found.
  The watcher's changes poke it only for its own file, that file's `.<file>.lock` sidecar, and anything under its artifacts directory, since a subagent's appends do not touch the session file, and a sibling session's writes leave it alone.
  The view's socket topic carries them as `media` messages: the whole list once the files are read, then only the images each later read added, which the page sorts in newest first.
  A file rewritten shorter, or the first read, sends the whole list again.
  The changes card's Images section sends selected images on: `PUT /api/pull-request/attachment` takes `PullRequestAttachment` from `src/shared/github.ts`, a pull request and 1 to 50 PNG, JPEG, GIF, WebP, or SVG images of up to 10 MB in base64, each with alt text, which are the limits and types of `gh pr edit --attach`.
  `attachToPullRequest` in `src/pull-request-edit.ts` writes them to a temporary directory, each named for its place and ending in its type's extension, since `gh` reads the type from it, runs `gh pr edit <n> -R <owner>/<repo> --attach <file>#<alt>` for every image, which appends them and keeps the body, and removes the directory however `gh` ends.
  When some uploads fail, `gh` exits non-zero yet still adds the others, so the error the page shows can come with a changed description.
  Each image for a Linear issue goes through `PUT /api/ticket/attachment`, as the new-issue dialog's files do.
- A view whose **Trajectory** a socket shows also gets a trajectory tail (`src/trajectory.ts`), which folds the view's own file into turns: a turn opens at each user message or `custom_message` that the transcript shows as a prompt, so the turns match the minimap's.
  Entries that wait for the model, such as a model change, a `model_usage` side call, a `ttsr_injection`, or a hidden `custom_message`, join the turn in which the next assistant message reads them, and are left out until one does.
  Each assistant message is a request with the `usage` omp recorded on it; `model_usage` entries are only side calls such as auto-thinking and cache warming, so a turn's usage adds both.
  `watch` lists those views in `trajectories`, and the watcher's changes poke the tail as they poke the transcript.
  The socket topic `turns:<view>` carries `turns` messages: every turn once the file is read, then only the turns each later read changed, which the page puts in place by id.
  A page that stops showing the Trajectory leaves the topic, and the tail closes when no socket shows it.
- The server lists the session files through each format's listing at startup and then once a minute, in case a watcher missed a change; omp's is omp's session listing, the code behind omp's session picker.
  Between listings it reads again only the session files the watcher reported, at most twice a second, so a session that streams costs one file read, not a listing of every session.
  The past list skips the empty sessions that omp's picker hides, and a Claude Code or Codex session with no prompt and no reply.
  It also skips an omp session whose own file holds an `omp-agents.headless` entry, which `templates/omp/agent/extensions/headless-mark.ts` appends at `session_start` when omp runs in `print` or `json` mode; `SessionFactsIndex.headless` reads it in the facts scan, so such a row shows until that scan first reads the file.
  The server looks up files by session id in this listing, so the page never sends a path.
  While no page is connected, it skips building the roster and the past list.
  The past list goes out whole when a page connects; after that the server compares each session with what it last sent and sends only the sessions that changed, joined, or left, so an untouched row keeps its object on the page and skips its render.
  `SessionFiles.past` hands back the same row object while the session's listed file, its facts, and its interruption are the same objects as before, and the comparison skips serializing a row it already sent as that object, so a push while one session streams serializes only that session's row.
- Whenever the list changes, the server also scans for pull requests in each session file whose modification time changed, plus the subagent files in its artifacts directory.
  Like an open transcript, each file reads only the bytes appended since its last scan.
  The first scan reads every session file, 16 sessions at a time.
  On 641 MB across 464 sessions it takes under a second, and the sidebar shows before it finishes.
  A session that names a PR by number alone, reads by number one its own prompt names, or works on a branch, costs one `git remote get-url origin` in its working directory.
  A `gt submit` call costs, once per directory it ran in, one `git remote get-url origin` and a `git reflog show HEAD` with a `git symbolic-ref HEAD`, which place the branch checked out at the call's time; the server keeps each call's branch for as long as it lists the session.
  A subagent's appends do not change the session file, so its pull requests show once the session writes again, at the latest when it receives the subagent's result.
  `resolveLinks` lists the pull requests a call worked on, submitted, or pushed, or that the session's branch heads, before those the session's own prompt only links or names, each in the order found, since the session details sidebar shows the first.
- The same scan collects the Linear issues each session worked on, by identifier, from the arguments of its Linear MCP calls: a direct `mcp__linear_<tool>` call or a `write` to `xd://mcp__linear_<tool>`, whose `content` holds the arguments as JSON.
  `get_issue` and `save_issue` name the issue in `id`, `list_comments` and `save_comment` in `issueId`; a `save_issue` with no `id` opens one, whose identifier its result's JSON `id` names.
  A UUID is left out, since the tickets page opens an issue by identifier.
  A `save_issue`, a `save_comment`, the `/ship` state's `issue`, and a Linear issue link in the session's own prompts each link the issue on their own.
  A read (`get_issue`, `list_comments`), the identifier in the session's own prompts, and the session's branch naming it, in a `/`-separated segment that starts with it as `eng-123-fix` or `me/eng-123` do, are weaker: an issue with only these links once two different kinds agree, so a subagent that reads its parent's issue for context does not link it.
  The session's own prompts are the user prompts in its own file, a skill's arguments without the skill's text, and no dashboard prompt; a subagent's prompt is its assignment, so it names nothing.
  `#resolve` in `src/session-facts.ts` decides which issues link, since the branch is known only once git answers.
  Session rows carry them as `tickets`, the session's own first.
- The same scan reads the branch each session that wrote works on, in its worktree else its directory, through `worktreeAt` in `src/git.ts`.
  In a linked worktree that is the branch checked out now; in a repository's main checkout it is the branch `headHistory` and `branchAt` in `src/git.ts` find checked out at the session file's last write, from the HEAD reflog.
  `defaultBranchOf` there reads the repository's default branch from `origin/HEAD` with one `git symbolic-ref` per directory of a session that wrote, so a moved `origin/HEAD` updates the `defaultBranch` of every session in that directory.
  Each of the three asks `git` again only once a file it read changed, the worktree's `HEAD`, its HEAD reflog, or `origin/HEAD` (`CachedCheckouts` in `src/git.ts`), so a refresh with no checkout moved starts no `git`.
  Session rows carry it as `branch`, a `SessionBranch` `{ name, linked, defaultBranch, pullRequest }` from `src/shared/sessions.ts`, `null` on a detached HEAD, outside git, or once the directory is gone, and a branch switch changes the row at the session's next write.
- Each read of the pull request list tells the server which branch heads which pull request in that repository.
  The server then links each session whose `git push` updated one of those branches, whose `gt submit` submitted one, or whose linked worktree has one of them checked out, to that PR, and sends the sidebar the new links.
  It also sets the `pullRequest` of each such session's `branch`, the PR it heads, and so links the PR of a main checkout's branch other than the default one too; the header's **Open PR** shows only while it is `null`.
- A `gt submit` line names a branch with its PR, so the server takes that PR as the branch's once, when it reads the line, unless the list names one for the branch.
- The list names a new PR only at the page's next read, up to a minute after the session opened it, only once GitHub's search has indexed it, some seconds after, and not at all while the list's GraphQL budget is spent.
  So while the list names no PR for a session's branch, the server asks GitHub which PR that branch heads, through one `gh api` REST call outside the search and the GraphQL budget (`branchPullRequest` in `src/pull-requests.ts`), and sets `pullRequest` from the newest open or merged one, or `null` when there is none.
  It asks at once when the session's transcripts name a PR it did not link before, such as the URL `gh pr create` prints, or finish a `gt submit` call, which may open one without printing it (`-q`).
  Otherwise it asks at most once a minute per branch, at a write of a session on it, so a failed ask is tried again, and a printed or answered PR that closed since is dropped.
  A printed or answered PR outlives later reads of the list, which search may still leave without it, until one names that branch, whose PR then takes its place and ends the asks.
