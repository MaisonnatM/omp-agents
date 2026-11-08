# Sport

- The **Sport** button in the header, a `#sport` address, or **Go to sport** in the command menu shows your training week in place of the panes.
  The sidebar then lists **Semaine**, **Journal**, and **Progrès**, the same three tabs the page's header shows.
  On a page narrower than 768 pixels, such as a phone's or a narrow window's, the tabs move to a row under the header, and **Séance libre** and **Pesée** show their icon alone.
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
  Below the workouts, **Chaque jour** lists the daily habits, with **Démos** and **Lancer** for one that follows a routine.
  A habit that follows a routine, such as the stretches, lists the routine's exercises with a box each, its dose and note, and a play mark when it has a demo; its count, such as `2 / 5`, says how many are ticked.
  A dose done on each side reads « par côté », such as `2 × 45 s par côté`, and its sets and hold count one side.
  Tick a box with a click, or with Tab then Space; the ticks are saved for that day, so another day shows its own.
- When you noted pain of 3 out of 10 or more in the last 7 days, a banner says where and when.
  Finger pain removes the fingerboard and every hang for the next 7 days; the open day shows them struck through.
- On a narrow page, while the open day has a workout not noted yet, a **Séance faite…** button stays at the bottom of the day.

## Lancer

- **Lancer** on a routine opens its timer over the whole screen on a phone, or over most of the page on a computer, for the open day.
- It counts down 10 seconds to get ready, then each hold of each set, the left side then the right for an exercise done on each side.
  Between two holds it gives 5 seconds, « Change de côté » between the sides of a set and « Suivant » before the next set or exercise; an exercise with a rest takes its rest instead.
  An exercise counted in reps rather than seconds waits for you: press **Suivant** once its reps are done.
- The color says what is under way: green for a hold, amber for getting ready and the time between holds, and blue once it is over.
  The countdown sits in a ring, under the exercise's name, its set and side, its note, and the first cue of its demo; below, « Ensuite » names the hold that follows, with the hold's number and the time left.
- The big button pauses and resumes, and the buttons beside it go back a step or skip to the next; Space, ←, and → do the same, and Esc or the cross closes the timer.
- It beeps on each of the last three seconds of a step and plays a rising tone as the next starts, and a French voice names what comes next and says « change de côté », when the browser can speak.
  The speaker button turns the sound off or on, and the timer remembers it for next time.
  The screen stays on while the timer runs, where the browser allows it.
- When an exercise's last hold ends, its box is ticked for the open day, alongside what was ticked already; skipping a hold does not tick it, and closing the timer early keeps what it ticked.
  An exercise counted in reps is ticked when you press **Suivant** on its last set.
- At the end, « Terminé » shows how long the routine took and how many boxes are ticked, and **Fermer** closes the timer.
- With reduced motion turned on, the color changes without the flash, and the ring moves a second at a time.

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
- **Enregistrer** saves and shows « Séance notée » with **Charge max**, the heaviest load and the exercise that lifted it, the sends, the effort, and any record it beat.
  The next sessions of that exercise start from the load you saved, until a new test or a new phase.
  The open session in the journal shows the same **Charge max**.
- **Pesée** notes a bodyweight, today unless you pick another day; a second weight on the same day replaces the first.

## Journal

- **Journal**, or `#sport/journal`, lists what you did, newest first, grouped by week with how many sessions were done and their planned hours.
  Each row reads its heaviest load, its hardest grade, its effort, and any pain; a row that set a record shows **Record**.
- Click a row to show it beside the list, with its loads, its sends, and its note; `#sport/journal?open=<id>` opens one.
  **Modifier…** opens it in the Fait dialog, and **Supprimer** removes it, with **Annuler** in the toast to put it back.

## Progrès

- **Progrès**, or `#sport/progress`, shows a card per measurement with how far it moved since the first, the best boulder and route of the last 8 weeks, your bodyweight's four-week average, and how much of the plan you followed.
  Click a card to chart it below, over 8 weeks, 12 weeks, or everything; a target shows as a dashed line labeled « Objectif » with its value, and a lone measurement shows as a dot.
- **Records** lists your best mark on each measurement, load, and grade since the beginning, with its date.

## What the page leaves out

- No minutes per block: the plan gives a workout's length, not its blocks', so the page shows the whole workout's length alone.
- One **Fait…** per workout: a note belongs to one workout, so a day with two workouts has two buttons.
- The week's address is `#sport`, not `#sport/week`, as the Notes page's first list is `#notes`.
