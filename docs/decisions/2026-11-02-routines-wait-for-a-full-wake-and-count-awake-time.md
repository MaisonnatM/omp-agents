---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Routines wait for a full wake and count a command's limit in awake time

In the context of routines run by a server on a Mac that sleeps, facing runs that started in a dark wake, stalled through the sleep that followed, and hit the 10-minute command limit on wall time, we chose to hold every automatic start and command report until the kernel's system capabilities list Graphics, read from `pmset -g systemstate`, and to count a command's limit with `performance.now()`, which stops while the Mac sleeps.
We rejected holding until the user is active or the Mac is on power, because a Mac on power still dark wakes for Power Nap and an awake Mac on battery should run, and rejected a native clock call through `bun:ffi`, because Bun's `performance.now()` already reads `CLOCK_UPTIME_RAW` on macOS.
We accept that each minute tick spends 10 to 40 ms on `pmset`, that a Mac whose `pmset` fails counts as awake, and that a command report held for a full wake is lost when the server stops first.

## Context

A command routine started at 10:07:50 in a dark wake; the Mac slept from 10:08:05 to 10:17:38, and the runner stopped the command at exactly 600 s of wall time, printing nothing.
Two prompt routines had model calls stall for 14 to 16 minutes the same way.
Bun's timers and `Date.now()` count sleep on macOS, since Bun's timers read `CLOCK_MONOTONIC`.
`pmset -g systemstate` prints `Current System Capabilities are:` and the kernel's `kIOPMSystemCapabilitiesKey` as words; a dark wake lists CPU and maybe Network, and a full wake adds Graphics and Audio.
XNU drops Graphics only on system sleep, not on display sleep, so a Mac awake with its screen off still runs routines.

## Options considered

- The Graphics capability from `pmset -g systemstate`.
  It is the kernel's own line between a dark wake and a full wake, at the cost of a subprocess each tick.
- User activity or AC power, as first proposed.
  It needs no subprocess, but it holds an unattended awake Mac and runs in Power Nap on power.
- Subscribing to IOKit power notifications.
  It costs nothing per tick, but needs a native helper the server does not have.

## Consequences

Missed slots coalesce into one run at the first full-wake tick, as they did after a closed dashboard.
News that comes for a routine whose triggered run still waits joins that run, so a night of dark wakes starts one run rather than pushing older news out of the 10 runs a routine keeps.
A command report that ends outside a full wake waits in memory and posts at the next full-wake tick.
**Run now** never waits.
A command run and its routine message keep `slept`, the wall time less the awake time to the second, and the message says how long the Mac slept, so the Bot does not diagnose a stall.

## Confirmation

`src/full-wake.test.ts` reads full-wake and dark-wake outputs, `src/proc.test.ts` runs a command past its limit with a frozen awake clock, and `src/server/routine-runner.test.ts` covers held ticks, joined news, held reports, and a run that slept.

## Revisit when

Scheduled sends or prompt routines' Bot turns show the same dark-wake stalls, which would move the wake check into a shared place, or the server gains a native helper that can hear IOKit's wake notifications.
