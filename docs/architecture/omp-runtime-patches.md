# omp runtime patches

The five runtime patches in `patches/`, which [omp modules](omp-modules.md) describes one by one, are written against upstream tag `v18.18.8`.
Each applies on its own; from a clean checkout of that release, apply all five, run their tests, and build the CLI:

```sh
for p in paid-cursor-fallback runtime-tool-contracts cursor-dynamic-tools-rule credit-balance-fallback rpc-ask-form; do git apply /absolute/path/to/omp-agents/patches/omp-18.18.8-$p.patch; done
bun install --frozen-lockfile
bun --cwd=packages/ai test test/auth-storage-model-usage-health.test.ts test/cursor-usage.test.ts test/cursor-system-prompt-history.test.ts test/rate-limit-utils.test.ts test/anthropic-stream-envelope.test.ts
bun --cwd=packages/coding-agent test test/paid-cursor-routing.test.ts test/write-xdev-dispatch.test.ts test/task/seance.test.ts test/agent-session-tool-rebuild-skip.test.ts test/tools/read-repeat-hint.test.ts test/agent-session-retry-fallback.test.ts test/rpc-extension-ui.test.ts
bun --cwd=packages/coding-agent run gen:bundle
```

A source checkout needs the matching pi-natives addon in `packages/natives/native/` before those tests.
Build once with all five applied, since a CLI built without one of them drops it.
Install the rebuilt `dist/cli.js` together with the files `gen:bundle` writes beside it, the `CHANGELOG-*.md`, `docs-index.generated.txt`, and data files the bundle loads by name, over the installed `pi-coding-agent/dist/`.
Keep the old data files beside the new ones until every running session restarts, since a running session loads them by its own hashed names.
Then copy each source file the patches change, as `git diff --name-only v18.18.8 -- packages/ai/src packages/coding-agent/src` lists them, over the installed one in `pi-ai/src/` or `pi-coding-agent/src/`, keeping a rollback copy of everything replaced.
Already-running sessions keep their loaded code until restarted.
