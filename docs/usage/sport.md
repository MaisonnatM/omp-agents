# Sport

- The **Sport** button in the header, a `#sport` address, or **Go to sport** in the command menu shows your training week in place of the panes.
  The sidebar then lists **Semaine**, **Journal**, and **Progrès**, the same three tabs the page's header shows.
  The page's words are in French, as the plan is.
- The header names the open day's phase and week, such as « transition · semaine 1 sur 3 ».
  **Séance libre** logs a session the plan did not schedule, and **Pesée** adds a bodyweight once a load rule subtracts one.
- With no plan yet, the page says what to ask your personal assistant, such as « Crée-moi un plan d'escalade de 4 semaines : poutre, bloc et routine hanche, avec mes charges de départ. »
  The assistant writes the plan through its `sport` tool; see [Personal sessions](personal-sessions.md).

## Semaine

- The list shows the open day's week and the next, Monday first, each under its phase and week, each day with its workouts, its length, and a check once done.
  A day's color is the kind of its longest workout: fingerboard, bouldering, route, hip, or strength.
  An optional workout reads « option », and a day with nothing planned reads « Repos ».
  Above the days, a bar counts the open week's workouts done out of those planned, an optional one counting only once done.
- Click a day, or press ← or → outside a text field, to show it beside the list; `#sport?day=2026-11-17` opens that day.
  The arrows above the list move a week at a time, and **Revenir à aujourd'hui**, shown once you leave this week, comes back to it.
- The open day shows each workout with its place, its length, its blocks, and each exercise's sets, hold, rest, and load.
  A load reads where it comes from: the test it was worked out from, such as « D'après le test du 26 août », or the session it was last lifted in, such as « Dernière fois +13 kg · 21 nov. ».
  A load with no measurement to work from reads « charge à tester ».
  Below the workouts, **Chaque jour** lists the daily habits, with **Démos** for one that follows a routine.
- When you noted pain of 3 out of 10 or more in the last 7 days, a banner says where and when.
  Finger pain removes the fingerboard and every hang for the next 7 days; the open day shows them struck through.
- On a narrow screen, while the open day has a workout not noted yet, a **Séance faite…** button stays at the bottom of the screen.

## Demos

- An exercise with a demo shows a play mark beside its name, and a workout shows its demos as thumbnails above its blocks.
  Click one to open the demos of the workout in a dialog, with three cues and what to watch for under each video.
  **Précédent** and **Suivant**, ← and →, or the thumbnails under the video, move between the demos.
- The dialog shows the video's thumbnail until you click play; only then does it load YouTube's player, from `youtube-nocookie.com`, so YouTube sees nothing until you choose to watch.
  The thumbnails come through the dashboard, which keeps each one on this computer after the first time.
- A routine such as « Mobilité hanche » opens as the demos of each of its exercises.

## Fait

- **Fait…** on a workout opens the dialog that notes it, and **Modifier…** edits a workout already noted.
  Each load starts on the planned one; uncheck an exercise you did not do, or type the load you used.
  Pick the effort from 1 to 10 and any pain from 0 to 10 with where it hurts, and add the boulders and routes you sent with their grade and color.
  On a test day, type the result; the coming loads are worked out from it.
- **Enregistrer** saves and shows « Séance notée » with the session's load, sends, effort, and any record it beat.
  The next sessions of that exercise start from the load you saved, until a new test or a new phase.
- **Pesée** notes a bodyweight, today unless you pick another day; a second weight on the same day replaces the first.

## Journal

- **Journal**, or `#sport/journal`, lists what you did, newest first, grouped by week with how many sessions were done and their planned hours.
  Each row reads its heaviest load, its hardest grade, its effort, and any pain; a row that set a record shows **Record**.
- Click a row to show it beside the list, with its loads, its sends, and its note; `#sport/journal?open=<id>` opens one.
  **Modifier…** opens it in the Fait dialog, and **Supprimer** removes it, with **Annuler** in the toast to put it back.

## Progrès

- **Progrès**, or `#sport/progress`, shows a card per measurement with how far it moved since the first, the best boulder and route of the last 8 weeks, your bodyweight's four-week average, and how much of the plan you followed.
  Click a card to chart it below, over 8 weeks, 12 weeks, or everything; a target shows as a dashed line.
- **Records** lists your best mark on each measurement, load, and grade since the beginning, with its date.

## What the page leaves out

- No minutes per block: the plan gives a workout's length, not its blocks', so the page shows the whole workout's length alone.
- No check-off for the daily habits: nothing stores a habit as done, so the page lists them without a box.
- One **Fait…** per workout: a note belongs to one workout, so a day with two workouts has two buttons.
- The week's address is `#sport`, not `#sport/week`, as the Notes page's first list is `#notes`.
