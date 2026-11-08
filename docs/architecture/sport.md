# Sport

`SportState` in `src/shared/sport.ts` holds the training plan, the metrics and their measurements, the targets, and the workout log.
The first version covers climbing, strength, hip work, and stretching.
`v` is the file's version, 1 today.
A **Measurement** is a dated number for a metric, such as a finger max of 112 kg or a bodyweight of 82 kg.
A **Target** is a metric value or a French grade for a boulder or a route, optionally with a date.
A **Workout log** is what the user did on a day: the workout it stands for, if any, done or skipped, the effort, a pain rating with where it hurts, the kilograms added per exercise key, and the boulders and routes climbed with their French grade.
French grades run from 4 to 9a in `FRENCH_GRADES`, and `gradeRank` orders them.

The plan holds workouts, routines, habits, phases, and dated overrides.
A workout has a kind, one of `hangboard`, `boulder`, `route`, `hip`, or `strength` in `WORKOUT_KINDS`, and lists blocks of exercises.
The page colors each day of the week by the kinds of its workouts.
A mixed session takes the kind it leads with, so a hip session with a few light hangs is `hip`, and the page never guesses a kind from the exercises.
An exercise has a stable key, optional sets, reps, hold and rest, an optional load rule, an optional demo video with three cues, and `hang` when it loads the fingers on a hangboard.
A load rule is either a fraction of a metric's newest measurement, less the newest measurement of the metric its `less` names, such as the bodyweight, plus an offset, or a fixed number of kilograms.
A **Phase** spans dated days with the slots of a normal week and of a **Deload week**, and names the Mondays of its deload weeks.
An override replaces one day's slots, as on a test day.

## The file

`applySport` in `src/sport.ts` is the pure reducer the server applies to its file.
`set-plan`, `set-targets`, and `set-metrics` replace their part whole.
Logs and measurements are added, edited, removed, and restored by id through one dated list; both stay in date order, a day's entries in the order they came, and a restore puts the entry back at its index when that keeps the order.
Every metric id in the state names one of its metrics: a change that names a metric the state does not hold is refused, and so is a `set-metrics` that drops a metric a measurement, a target, or a load rule still names, so the metrics come first.
A change that changes nothing or is refused returns the same state.
`applySportChanges` applies a list of changes in order, each checked by `sportRefusal` against the state the ones before it leave, and refuses the whole list with the first refusal's reason, so a list is kept whole or not at all.

`SportFile` uses `ReducerFile` to keep `sport.json` beside the access token.
`parseSportState` and `parseSportChange` in `src/sport-parse.ts` read the file and the socket's changes with the same field parsers under two rule tables.
A missing optional field takes its default and a field the module does not know drops; a field of the wrong shape or type refuses the whole state or change.
The file is held to shapes and types alone, so a length limit, a range, or a plan check tightened later never refuses data already saved.
A change is also held to the length and range limits, a YouTube id of 11 characters, and lists of at most 200 items.
A change's `of-max` load rule must name its `less`, `null` to subtract nothing, because a rule written before `less` existed subtracted the bodyweight and would otherwise read as subtracting nothing; the file still reads a left-out `less` as `null`.
A workout's `kind` is required in the file and in a change alike, since no file was written before it existed; a left-out or unknown kind is refused, such as `plan.workouts[0].kind must be one of hangboard, boulder, route, hip, strength`.
A `set-plan` is refused when its slots, habits, or `opensAs` lists name nothing, its ids or override days repeat, a phase ends before it starts or overlaps another, or a deload Monday is not a Monday of its phase; a `set-targets` or `set-metrics` is refused when its ids repeat.
A refused change says why, with the path of the first wrong field and the rule it broke, such as `plan.routines[0].items[0].demo.youtubeId must be 11 characters`.
A file that does not read, or that comes from a newer version, moves aside to `sport.json.invalid` rather than being overwritten.
The `ListRegistry` connects `sport-changes` client messages to `sport` snapshots on the roster topic; `SportFile` applies each message's list through `applySportChanges` and throws its refusal, so the registry resends the state to the page that sent it and the page's request fails with the reason.
The page keeps the latest snapshot in `DashboardState.sport`, `null` until the first one comes.

## The agent

A personal session's `sport` tool never writes `sport.json`; it leaves one request per call as a JSON file in `sportInboxDir`, `<config dir>/sport-inbox`, and the server stays the file's only writer.
A request holds the id of the session that left it, the metrics the call adds or replaces by id, and one change, and an edit names the entry and only the fields it changes.
See [Personal sessions](personal-sessions.md) for the tool's actions.
`SportInbox` in `src/server/sport-inbox.ts` builds on `JsonInboxDir`, so the dashboard that holds the owner lock applies the files oldest first, through the same `ListRegistry` path as the page, and a stopped dashboard leaves them for the next start.

`agentSportChanges` in `src/sport-agent.ts` turns a request into the changes it applies, the same for the tool before it leaves a file and for the inbox before it applies one.
It resolves the request against the state at hand, so an edit merges its fields over the entry as it stands then, and a request applies whole or not at all.
An agent may set the plan, at most `MAX_PLAN_BYTES`, 64 KB as JSON, and the targets, and add or replace metrics by id.
A request with no session id is refused.
It may add a log or a measurement only in its own session's name, its `addedBy`, under an id no entry holds, and edit one only when its own session wrote it, keeping its id and `addedBy`; another session's edit is refused with `workout log <id> was added by session <id>; an agent may edit only a workout log its own session wrote`.
It may never edit what the user wrote, nor remove or restore anything; only the Sport page does.
See [An agent signs Sport changes with its session id](../decisions/2026-11-07-an-agent-signs-sport-changes-with-its-session-id.md).
The resulting changes must also pass `sportRefusal` in `src/sport.ts`, so a change naming an unknown metric says why rather than vanishing.
The inbox sets a refused file aside as `.invalid` and logs the reason.
The inbox deletes a file only once its changes reach `sport.json`, and an add the state already holds as it is applies as nothing, so a file applied once and kept after a failed write does no harm when it is read again.
See [A sport tool call leaves one request the server resolves](../decisions/2026-11-07-a-sport-tool-call-leaves-one-request-the-server-resolves.md).

## The week

`src/sport-week.ts` derives everything else, the same for the page and the agent.
Every date is a `YYYY-MM-DD` day computed on the calendar alone, so no time zone or daylight saving change moves a Monday.

`dayPlan` gives one day of the plan and `weekPlan` the seven days of a week, reading the pain flags once for the whole week.
A day takes its override when the plan has one, else the deload slots of its phase when its Monday is a deload Monday, else the phase's normal slots; a day outside every phase has none.
Each workout carries its own fields, its exercises with their load, and the day's log of it, done or skipped.

`loadFor` gives an exercise's load on a day with where it comes from: the log that lifted it, or the rule with the day of the max it read.
A skipped log adds no load, climb, or record; only its pain still flags.
The newest load logged done for the exercise before that day wins while both days fall in the same phase and no newer measurement of the rule's metric came since the log.
Otherwise the rule gives it from the newest measurements on or before that day, rounded to the kilogram, and an unknown measurement of either metric gives an unknown load.
An exercise without a rule takes its last logged load within the phase and has none after.

`painFlags` lists the logs of the last 7 days whose pain is 3 out of 10 or more.
A finger pain flag removes every `hang` exercise for the 7 days after its log; `removesHangs` says which places do, and the page words its rule with `painRule`.
`bestGrades` gives the hardest boulder and route per week, `records` the best of each metric, logged load, and grade with the day it was first reached and the log that reached it, and `adherence` the share of planned workouts done, an optional one counting only once done.
`testedMetric` gives the test a workout holds, its first exercise keyed by a metric, and `bodyweightMetric` the metric an `of-max` rule subtracts.

## The page

The Sport page, `SportPage` in `web/components/sport/page.tsx`, draws `DashboardState.sport` and reads every date, load, flag, and record from `src/sport-week.ts`; `web/sport-view.ts` only words them.
Its route is a `SportRoute` from `web/routing.ts`: `#sport` and `#sport?day=<YYYY-MM-DD>` for the week, `#sport/journal` and `#sport/journal?open=<log id>` for the journal, and `#sport/progress`.
A change the page makes is a `SportChange`, the same the agent's tool sends.
The page dispatches a list of them as a `sport-changes` action, which applies `applySportChanges` to the state at once and keeps the state as it was when the list is refused, then sends `{ t: "sport-changes", changes }` on the socket; the server applies the list to the file whole or not at all, and every socket then gets the state as it is after.
The Fait dialog saves the log, a test's max, and its weigh-in as one list built by `logSave` in `web/sport-view.ts`, stays open and busy until the server answers, and shows a refusal's reason without closing; the Pesée dialog does the same with its one measurement.

A demo shows its YouTube thumbnail from `GET /api/sport/thumb?id=<video id>`, in `src/server/sport-thumbs.ts`, which fetches `hqdefault.jpg` from `i.ytimg.com` the first time and keeps it as `<id>.jpg` in `sportThumbsDir`, so the page's `img-src` stays `'self'`.
The player is an iframe on `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1` that `DemoDialog` mounts only after the play click, which the CSP's `frame-src` allows; see [the decision](../decisions/2026-11-07-play-exercise-demos-from-youtube-nocookie.md).

The progress chart is `ChartView` from `web/components/session-chart.tsx`, loaded with `React.lazy`, with `dashed` naming the target's series, `format` writing the axis and tooltip values, and `fit` fitting the axis to the values instead of starting at zero.
