---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# A logged load holds until the next measurement or phase

In the context of computing an exercise's load for a day, facing a load rule that follows the newest test and a load the user actually lifted that may differ from it, we chose that the newest logged load wins only while no newer measurement of the rule's metric came since that log and the log falls in the same phase as the day, over always taking the rule and over always taking the last log.
This keeps what the user really managed between tests and resets to the rule when a test or a new phase says the numbers moved, accepting that a load logged just before a test is dropped even when the test confirms it.
An exercise with no rule takes its last logged load within the phase.
Only a log marked done counts, and the load names its source, the log by id and day or the rule with the day of the max it read, so the page and the agent can say why a number is what it is.
`loadFor` in `src/sport-week.ts` implements it, and `src/sport-week.test.ts` covers the log, the new test, and the phase change.
