---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# Rebase tests copy one built repository and wait 30 seconds

In the context of `src/pull-request-rebase.test.ts`, facing tests that timed out at Bun's 5-second default when full suites ran on a busy machine, where each git call took 300 to 450 ms, we chose to build the repositories once in `beforeAll`, copy them for each test with `cpSync`, and give that file a 30-second default with `setDefaultTimeout`.
We chose this over raising only the deadline, which leaves each test starting 33 git processes before its own work, and over a suite-wide timeout in `bunfig.toml` or on the command line, which would let a hang in any other file run six times longer before it fails.
Copying cuts the file from 726 git processes to 330, and with every git call slowed to 330 ms its longest test takes 9.2 seconds.
We accept that a copy's `.git/config` names the template's paths until `setup()` rewrites them, and that a test which really hangs fails only after 30 seconds.
