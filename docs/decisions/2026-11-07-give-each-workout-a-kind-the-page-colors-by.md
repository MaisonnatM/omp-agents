---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# Give each workout a kind the page colors by

In the context of a Sport page that colors each day of the week by what its workouts train, facing a `Workout` with no type, we chose a required `kind` on each workout, one of `hangboard`, `boulder`, `route`, `hip`, or `strength`, over guessing the type from the exercises and over a list of kinds per workout. The plan states what a session is for, so a hip session with a few light hangs reads as `hip` rather than as a hangboard day because one exercise has `hang`. We accept that a mixed session, such as hangs then limit boulders, shows only the kind it leads with, and that the plan editor must set one more field.

The field has no default in the file either: no `sport.json` was written before it, so a left-out kind is refused in the file and in a change alike rather than read as a guess. Revisit when the page needs to show both halves of a mixed session, which would turn `kind` into a list.
