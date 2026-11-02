---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Describe native daily compression without scheduling it

For the Compress daily setting, facing dashboard RPC sessions that never run native interactive startup, we chose a terminal-launch hint over calling the native scheduler from the dashboard.
This states the setting's real behavior, accepting that dashboard-only users must compress manually.

## Context

Native automatic compression starts at most once daily from interactive terminal startup.
The setting already exists and can be saved through the generic settings writer.

## Options considered

- Explain that the native switch runs on terminal launch and show its last log.
- Call the native scheduler from the owner tick, adding dashboard automation not present before this change.

## Consequences

Storage imports only the native log filename, not its scheduler.
The switch remains editable and its hint names the terminal-only trigger.

## Confirmation

The hint and read-only log are present; no dashboard caller of scheduleGcAutoCompress is added.

## Revisit when

Revisit if omp makes its automatic compression lifecycle apply to RPC sessions too.
