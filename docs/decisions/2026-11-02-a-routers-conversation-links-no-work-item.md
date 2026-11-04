---
status: deprecated
date: 2026-11-02
decision-makers: user, agent
---

# A Router's conversation links no work item

In the context of a Router whose conversation reads pull request events and whose workspace's branch may head a pull request, facing its own session claiming that pull request so its `start_task` on it was refused, and counting as the agent on it so the event hid and then fired again, we chose to drop every pull request and Linear issue from the facts of a Router's conversation where the dashboard reads them, through `routerLinks` in `src/shared/router.ts`, over exempting the Router from task claims alone and over stopping prompt URLs from linking for every session.
A Router hands work to tasks and never does it, so nothing should treat its live conversation as working on one: not the claims, not `agentOn`, not merge cleanup, and not its row.
A saved Router conversation keeps its links in the past list, where nothing acts on them.
We accept that its row in Sessions no longer shows the pull requests it talked about, which its Tasks tab shows instead through the tasks that follow them.
