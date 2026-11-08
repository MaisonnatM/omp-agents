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
A change that changes nothing or is refused returns the same state, so the `ListRegistry` resends the state only to the socket that sent it.

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
The `ListRegistry` connects `sport-change` client changes to `sport` snapshots on the roster topic.
The page keeps the latest snapshot in `DashboardState.sport`, `null` until the first one comes.

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
A finger pain flag removes every `hang` exercise for the 7 days after its log.
`bestGrades` gives the hardest boulder and route per week, `records` the best of each metric, logged load, and grade with the day it was first reached, and `adherence` the share of planned workouts done, an optional one counting only once done.
