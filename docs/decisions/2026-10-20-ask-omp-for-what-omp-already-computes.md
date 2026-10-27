---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# Ask omp for what omp already computes

Plan quota comes from `omp usage --json`, and Gmail and Google Calendar use the tokens omp holds for their MCP servers.
omp already owns that setup and those sign-ins, so the dashboard needs neither a copy of the logic nor a sign-in of its own.
See [Plan quota](../architecture/plan-quota.md), [Google Calendar](../architecture/http-api-google-calendar.md), and [Gmail](../architecture/http-api-gmail.md).
