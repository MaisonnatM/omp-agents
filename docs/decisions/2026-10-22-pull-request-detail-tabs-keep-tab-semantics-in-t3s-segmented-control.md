---
status: accepted
date: 2026-10-22
decision-makers: Maxence Maisonnat
---

# Pull request detail tabs keep tab semantics in T3's segmented control

`web/components/segmented-tabs.tsx` uses Radix Tabs for selection, keyboard focus, and panel relationships, rather than copying T3's toggle semantics.
Its 24px items and selected backgrounds match T3 without changing Fluid's tabs elsewhere in the dashboard.
Count badges are omitted from the strip, while accessible names keep comment and pending-finding counts.
The checks popover follows T3's attention, running, and completed order and folds completed checks only while another check needs attention or is running.
The existing check shape has no durations or separate workflow-approval state, so the page presents only the statuses and links the server reports.
See [Pull request details](../usage/pull-request-details.md).
