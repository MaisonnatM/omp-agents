# Notifications

`src/server/notices.ts` owns the bell's notices: what the last checks found, the status of each update a page started, and which notices the user saw, read, or cleared, which it keeps in `notices.json` beside the access token.
Each kind has its own check, and `src/server/loops.ts` runs five of them.
The update check (`UPDATE_KINDS`) runs at startup and every six hours, whether or not a page is connected, and again after each update that succeeds.
The activity check (`ACTIVITY_KINDS`) runs every two minutes while a socket listens, and when a socket opens unless it ran since the last tick that found none.
The provider check (`PROVIDER_KINDS`) runs after each `omp usage` run of the usage tick, every minute while a socket listens, and when a socket opens unless it succeeded since the last tick that found none; a continue's own run skips it ([Plan quota](plan-quota.md)).
The event check (`EVENT_KINDS`) runs on the minute tick, whether or not a page is connected.
The dashboard check (`DASHBOARD_KINDS`) runs at startup and every five minutes, whether or not a page is connected: `SelfUpdate.newCommits` fetches the branch the server runs from origin and counts the commits past the running one.

- `latestOmp` in `src/omp/release.ts` asks `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts` for the newest release on omp's `update.channel`, unless `startup.checkUpdate` is off.
  `installedOmp` reads the version from the installed package's `package.json` on each check, so the check is right after an update, before a restart.
- `findModelUpdates` in `src/omp/model-updates.ts` reads the global `modelRoles` and `retry.fallbackChains` entries with `resolveSelector`, and keeps the listed models that `classifyModel` in `pi-catalog/src/identity/index.ts` places in an Anthropic or OpenAI family with a revision.
  A model's line is its provider, its family, and its id with the version masked, so `claude-opus-5-5` and `claude-opus-5-6` share one.
  It offers the newest revision of each line that a connected provider lists, and leaves dated snapshots out.
- The pull requests come from `loadPullRequests` in `src/pull-requests.ts` over the known workspaces that still exist, through the pull request list's 30-second cache, so the page's polls and the check share one query.
  `moveOf` in `src/shared/moves.ts` picks each one's move, with `agentOn` over the roster, and a move in `YOUR_MOVES` is a notice.
- `waitingOnYou` in `src/slack-messages.ts` calls Slack's Web API with omp's Slack MCP sign-in through `integrationFetch("slack")`, since the MCP server's search answers in Markdown and Slack's `search.messages` needs a scope the sign-in lacks.
  `auth.test` names the user, and two `assistant.search.context` searches over the last three days, newest first, read the direct and group messages (`im,mpim`) and the channel messages that mention them (`<@ID>`), each up to five pages of 20 through `next_cursor`.
  A conversation gives one notice for the messages after the user's last one there; the user's own messages, bots, Slack's system messages, and empty ones count for nothing.
  `slackText` turns Slack's markup into plain text.
  `users.info` gives each author's 72-pixel profile picture as the notice's `avatarUrl`, which the page's `img-src` allows from `avatars.slack-edge.com`, `secure.gravatar.com`, and `a.slack-edge.com`; a lookup that fails leaves it `null`, and the page shows the initial.
  Without a Slack sign-in, which `integrationSignedIn("slack")` reads, the check finds nothing.
- The plan notices come from the plans of the last `omp usage` run, which `Broadcasts.refreshUsage` answers with, one per window whose `exhausted` is set; when that run failed, the check fails too and keeps its notices.
- `readCreditRuns` in `src/omp/stats.ts` reads the last day's requests, in order, of each provider that had an error naming `402` then, aborted requests left out.
  `creditRuns` starts a run at a failure whose error names `402` and that `is402BillingCapBody` reads as a billing cap, counts each such failure after it, and ends it at the provider's next request that worked; another error neither starts nor ends a run.
  A provider with a run open is a notice.
- The events come from `LocalEventsFile` and, for each signed-in Google Calendar account, `GoogleCalendars.byAccount` over the next ten minutes (`EVENT_LEAD_MS`), each timed event a notice from that lead before its start until its end, dated at that lead.
  Google's events, one scope per account, and the local ones are separate scopes: an account whose read fails keeps its notices as they were while the other accounts' change, and the Calendar page shows why.

A check that fails keeps what the last one found for its kind, and the marks for it, and logs each distinct error once.
A repository GitHub did not answer for keeps its pull requests' notices the same way.
A notice whose update runs or ran stays after a check stops finding it, so the page shows how the update ended.
A notice's id names what it is about, so it is a new notice when that changes, even after the user cleared the last one: `omp:<latest>`, `model:<provider>/<from>><to>`, `dashboard:<running commit>`, `pull-request:<owner>/<repo>#<number>:<move>`, `slack:<channel>:<ts>` of the newest message, `plan:<provider>/<account>:<limit id>`, `credits:<provider>`, or `event:local/<id>:<start>` and `event:google/<account>/<calendar id>/<event id>:<start>`, so a moved event is news again.
The dashboard notice names the running commit rather than origin's, so new commits raise its count instead of toasting again, and only a restart onto another commit makes a new one.
A plan notice's id leaves out the reset time, which a provider may report a little differently on each run, and a credits notice's leaves out its first failure, which moves once that failure is older than the day the check reads; the window's reset or a request that works ends the notice, and the next time it comes after its marks lapse is news.
A Slack notice dates from its message, and a credits notice from the first failure the check reads.
A pull request notice dates from the check that found it, since the pull request's last update on GitHub may predate the move, except on its repository's first answer since startup, which dates each from that update, so a workspace found later or a repository GitHub answers again does not bring old pull requests as news.
The marks of a notice the checks stop finding last ten minutes, so a pull request whose checks run again, which leaves **Ready to merge** for a moment, keeps its marks, and one that comes back later is news again.
Each notice carries its scope when its check finds it, its kind, a pull request's `owner/repo`, or `event:local` or `event:google`, and a check answers for the scopes it looked at, never by reading ids back.
`notices.json` keeps each marked notice's scope under `scopes`, so a restarted server forgets the marks of a notice that is gone from an answered scope; a mark from a file without `scopes` stays until its notice is found again.

A `notice` socket message carries `{ ids, op }`, with `op` one of `update`, `seen`, `read`, and `clear`.
`update` runs on update notices and marks them seen and read.
Every socket hears the list as a `notices` message on the roster topic after each change, also sent when a socket opens.
`update` on omp runs `omp update` through `ompCommand` and succeeds when omp exits 0 and the version on disk is at least the notice's release; otherwise it fails with omp's last line of output, such as Nix's.
The server keeps the omp modules it loaded until it restarts, and `src/omp/modules.ts` names any export the new release dropped at the next start.
`update` on a model calls `upgradeModel` in `src/settings.ts`, which turns `upgradeEdits` into routing edits and writes each with `writeRouting`, under the same lock as a Settings › Models save.
A role or chain entry keeps whatever follows the model in its selector, such as `:high` or `:auto`, and each chain that names the model is written whole.
`update` on omp-agents' own notice calls `SelfUpdate.update`, as [Updating the dashboard](updating-the-dashboard.md) says, and fails with its refusal.
No check follows its success, unlike omp's and a model's: the server restarts and checks at startup, and a fetch run now would still hold `.git`'s lock when that check fetches.

## Session notifications

The Dock badge and the session notifications count on the roster: the server keeps whether each live session waits on you, and each page decides what to show of it.
A row's `status` of `needs-input` says that the session asks something, and its `unread` names the turn it ended since you last looked: when, and the first line of its last reply.
Both transports report the main agent's turn as a `TurnUpdate` from `turnUpdate` in `src/live-session.ts`: `turn-started` at `agent_start`, and `turn-ended` with its last reply and its usage limit at an `agent_end` that ends the run, not one that hands over to a queued follow-up.
The same `turn-started` cancels a continue the session waits on, and only a `turn-ended` with a limit from a session this server started schedules one ([Scheduled sends](scheduled-sends.md)).
`Dashboard` applies each in `#onLiveUpdate` through `LiveSessions`, which keeps the unread turns privately by instance id in memory, adds them to each row in `rows()`, and drops one when its session leaves.
`turn-ended` sets the turn with `markUnread` and always pushes the roster; `turn-started` clears it with `markRead` and pushes the roster only when a turn was unread.
A page sends `{ t: "read", instanceId }` while a pane shows the session's main agent in a focused window, which `LiveSessions.markRead` clears for every page.

`useAttention` in `web/use-attention.ts`, over the pure rules in `web/attention.ts`, leaves out a project's workers, which answer to their coordinator, and counts the rest that need you for the desktop's badge.
Each session raises at most one alert at a time, for what it waits on: its oldest open question, else a wait with no question relayed, else its unread turn.
`attend` keeps an episode per live session: the first roster that shows a session hears its wait and raises nothing, so neither a page that loads nor a terminal session that joins after the socket's first roster raises what already waited.
A wait with no question raises only when it starts after the page saw the session not need you, and a question that follows it in the same wait is the question the host replays after a guest's welcome, so it raises nothing.
A question, by its request id, or an unread turn, by its time, that the page has not heard raises its alert while **Settings › Preferences › Notifications** is on, and stays heard while the session lives, so a question a reconnect replays raises none again.
An alert carries the hash that opens its session, `#session/<session id>`, from `hashForSession`, so the shell needs nothing of the roster's shapes.
In the desktop app the alert goes through the bridge to `desktop/attention.ts`, which shows an Electron `Notification` unless its window has focus, as `BrowserWindow.isFocused` tells, and, on its click, shows the window and sets the page's hash to the alert's; it holds each session's latest notification, closing the one before, since Electron drops a click of one nothing references.
In a browser it is a Web `Notification` tagged with the alert's hash, so a session's newer one replaces the one before, raised while the page does not have focus, once the browser granted the permission that turning the switch on asks for.
