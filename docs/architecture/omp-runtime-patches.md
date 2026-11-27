# omp runtime patches

The six runtime patches in `patches/`, which [omp modules](omp-modules.md) describes one by one, are written against upstream tag `v19.0.0`.
Each applies on its own; from a clean checkout of that release, apply all six, run their tests, and build the CLI:

```sh
for p in paid-cursor-fallback runtime-tool-contracts cursor-dynamic-tools-rule credit-balance-fallback rpc-ask-form lazy-mcp; do git apply /absolute/path/to/omp-agents/patches/omp-19.0.0-$p.patch; done
bun install --frozen-lockfile
bun --cwd=packages/ai test test/auth-storage-model-usage-health.test.ts test/cursor-usage.test.ts test/cursor-system-prompt-history.test.ts test/rate-limit-utils.test.ts test/anthropic-stream-envelope.test.ts
bun --cwd=packages/coding-agent test test/paid-cursor-routing.test.ts test/write-xdev-dispatch.test.ts test/agent-session-tool-rebuild-skip.test.ts test/agent-session-retry-fallback.test.ts test/rpc-extension-ui.test.ts test/mcp-lazy-stdio.test.ts
bun --cwd=packages/coding-agent run gen:bundle
```

A source checkout needs the matching pi-natives addon in `packages/natives/native/` before those tests.
Build once with all six applied, since a CLI built without one of them drops it.
Install the rebuilt `dist/cli.js` together with the files `gen:bundle` writes beside it, the `CHANGELOG-*.md`, `docs-index.generated.txt`, and data files the bundle loads by name, over the installed `pi-coding-agent/dist/`.
Keep the old data files beside the new ones until every running session restarts, since a running session loads them by its own hashed names.
Then copy each source file the patches change or add, as `git diff --name-only v19.0.0 -- packages/ai/src packages/coding-agent/src` and `git ls-files --others --exclude-standard -- packages/ai/src packages/coding-agent/src` list them, over or beside the installed one in `pi-ai/src/` or `pi-coding-agent/src/`, keeping a rollback copy of everything replaced and a list of the files added, such as `usage-aware-routing.ts`.
Already-running sessions keep their loaded code until restarted.

## Lazy MCP servers

`omp-19.0.0-lazy-mcp.patch` starts stdio MCP servers on their first call when `OMP_MCP_LAZY=1`, which the dashboard sets for every session it starts, in `pi-coding-agent/src/mcp/manager.ts` and `pi-coding-agent/src/mcp/tool-cache.ts`.
A server seen before registers its tools and instructions from the manifest omp caches in `agent.db`, keyed by server name and checked against a hash of its config; one never seen is started once to fill that manifest, then stopped.
A started server stops after `OMP_MCP_LAZY_IDLE_MS` (10 minutes) with no call, except a browser server, which keeps its pages until the session ends; one that exits is started again only by its next call.
[Its record](../decisions/2026-11-27-mcp-servers-start-on-their-first-call-through-a-runtime-patch.md) says why.
