---
status: accepted
date: 2026-11-20
decision-makers: Maxence Maisonnat
---

# Give a multi-session effort a project brief and a roster group

In the context of one large effort that runs across many omp sessions and workspaces, facing new sessions that start without knowing where the work stands and an effort that shows nowhere as a whole, we chose a Project, a server-owned brief of goal, plan, decisions, and log that every session in it gets at start, with a roster group that gathers its sessions and a page for the whole effort.
We chose it over mirroring a Linear project, over a project-lead Bot, over one session's goal shared by many, and over a roster group alone, to give each session the state of the work without depending on another service or a long-lived agent.
We accept a second place to keep a plan beside Linear, and that a session is in one project at most.

## Options considered

- Mirror a Linear project: the plan would live where tickets do, but every effort would need a Linear project, the brief would wait on Linear's API at each start, and decisions and log lines have no home there.
- A project-lead Bot: one long-lived session would hold the plan and brief the others, but its context runs out, and the plan lives only in its conversation.
- Share one session's goal across sessions: no new store, but a goal alone holds no plan, decisions, or log, and nothing groups the sessions.
- A roster group alone: the sessions would show together, but a new session would still start knowing nothing.
- A brief and a roster group, named Project: chosen.

## Consequences

`project-list.json` holds every project, and only the server writes it; agents change it through `project-inbox/`.
An agent may make every change the Projects page makes, on any project: create, rename, set the goal, archive, restore, edit the plan and the decisions, log, and join or leave for any session.
The user asked for it, and an allowlist only pushed those changes back to the page; the server stays the only writer and parses every change as it parses the page's, so an agent's change is no less safe than a click.
The starter kit's `project` extension sends the brief at a session's first prompt and again when the project changed, and its guidance asks agents to tick a step and log a line once they finish one.
"Project" no longer means a workspace in this codebase's words; see the glossary.
The Projects page has no list column, as [the Todo page](2026-11-17-the-todo-page-has-no-list-column-and-filters-by-category.md) has none: `#projects` is a table of every project, and an open project takes the page's width with its plan and sessions beside its decisions and recent activity.
See [Projects](../architecture/projects.md).
