---
status: accepted
date: 2026-11-20
decision-makers: user, agent
---

# Agents may add a Todo section but not rename or remove one

In the context of the `user_todo` tool, facing a user who asked an agent to file todos under a section that did not exist yet while the todo inbox set aside every section change, we chose an explicit `add-section` action that the inbox applies as `add-category`, over creating a section whenever `add` or `edit` names an unknown one, to let an agent set up the section the user names, accepting that only the user still renames, removes, or reorders sections.

## Context

The tool could already file a todo in an existing section, and the Todo page could add one, but an agent had no way to add one, so the user had to stop and create it by hand.
The tool and the dashboard share no lock: the tool leaves a change in the inbox and the server applies it a moment later.

## Options considered

- **An explicit `add-section` action.** A typo in `add` or `edit` still files the todo in no section instead of creating a stray one; a todo can be filed in the new section at once, because the tool also reads the sections still waiting in the inbox.
- **Create the section that `add` or `edit` names.** One call fewer, but a misspelled name makes a new section, and several calls in a row before the server applies the first would each make one.

## Consequences

`add-section` refuses a name that matches an existing or waiting section, case-insensitively.
Renaming, removing, and reordering sections stay on the Todo page; the inbox still sets those changes aside.

## Revisit when

Agents add sections the user did not ask for, or the user wants agents to rename or remove them.
