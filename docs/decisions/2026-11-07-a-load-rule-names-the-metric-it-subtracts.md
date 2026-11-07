---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# A load rule names the metric it subtracts

In the context of an `of-max` load rule, which gives a hang's added kilograms as a share of a total max less what the user weighs, facing a reserved metric id `bodyweight` that the rule subtracted by convention, we chose to have each rule name the metric it subtracts in `less`, or `null` for none, over the reserved id.
A plan then says what it reads, a rule for a total load such as a deadlift subtracts nothing, and renaming the bodyweight metric only means changing the rules that name it.
We accept that every hang rule repeats `less: "bodyweight"`.

## Options considered

- Keep the reserved `bodyweight` id: shorter rules, but a set of metrics without that exact id turns every hang load unknown without a word.
- Name the subtracted metric in each rule: chosen.

## Consequences

`applySport` in `src/sport.ts` refuses a change that names a metric the state does not hold, and a `set-metrics` that drops a metric a measurement, a target, or a load rule still names, so a rule's `metric` and `less` always name a metric.
`parseSportChange` refuses an `of-max` rule that leaves `less` out, so a rule written in the old shape, which subtracted the bodyweight, is not saved as one that subtracts nothing.
