---
status: accepted
date: 2026-11-26
decision-makers: Maxence Maisonnat
supersedes: [2026-10-30-a-todo-names-one-workspace-and-the-sidebar-scopes-the-lists, 2026-11-09-todo-sits-between-calendar-and-sport, 2026-11-17-the-todo-page-has-no-list-column-and-filters-by-category, 2026-11-20-agents-may-add-a-todo-section-but-not-rename-or-remove-one]
---

# Remove the Todo page, the user_todo tool, and the todo store

In the context of the dashboard's own todo list, its Todo page, the starter kit's `user_todo` tool, and the `todos.json` store behind them, facing a feature the user asked to remove, we chose to delete all of it outright over hiding the page or keeping the tool without its page, to drop a page, a socket list, a settings sync store, a file inbox, the session-to-todo link on new sessions, and a starter-kit tool from every session's prompt, accepting that todos already saved stay unread in `todos.json` and `todo-inbox/` on disk.
The removal also takes the `@todo:` mentions, the command palette's todos and **Create todo**, the desktop app's quick-capture shortcut that opened it, the todo quick actions **Work on it** and **Plan it**, and the daily clean-up of closed todos.
omp's own `todo` tool, the agent's checklist inside a session, is a separate feature and stays; so do the Board, Projects, and their plan steps, which hold work that sessions share.
