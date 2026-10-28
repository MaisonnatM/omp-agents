# Model roles and fallbacks

Read this before configuring models, reasoning levels, fallback chains, or responding to quota exhaustion.

## Sources of truth

Roles live under `modelRoles` in `config.yml` inside `PI_CODING_AGENT_DIR`, or `~/.omp/agent` when unset; `omp config get modelRoles` is authoritative.
Fallbacks are `retry.fallbackChains`, an ordered list for each role.
Check `omp usage` at the start of a long session and before changing routing.
Claude and Codex report 5-hour and 7-day windows; Cursor reports monthly usage.
Use `omp models --json` to choose selectable `provider/modelId` selectors; an unavailable slug breaks delegations that read the role.
A `:level` suffix overrides the failing turn's reasoning level; a bare fallback entry keeps it.

## Provider order and quota policy

Keep selected providers in this order in the roles, their fallback chains, and `modelProviderOrder`; a role's chain may omit providers:

1. Anthropic — every role's configured primary.
2. OpenAI Codex — first fallback.
3. Cursor — Composer for cheap roles, after Codex when configured.
4. OpenRouter — last fallback, open-weight models only, with no Anthropic, OpenAI, Google, or xAI proxies.

Cursor subscription quota is not a reason to put it ahead of Anthropic or Codex.
Cursor Grok is explicit-selection only, not an automatic role fallback.
The retrospective found large uncached-input costs on that fallback; removing it trades fallback availability for controlled cost exposure.
When every eligible configured coding-plan route is depleted or unavailable, use the explicit terminal `retry.paidFallback: cursor/claude-opus-5-5` if enabled; otherwise report quota exhaustion.
Do not add Grok or other metered providers.
Keep `retry.usageAwareFallback` enabled, `retry.usageReservePct: 0`, and `retry.usageReservePolicy: auto`.
The first three providers use coding-plan quota; use eligible configured plans before paid Cursor or OpenRouter.
Skip a provider only when it reports zero remaining quota; a plain API key or unknown usage remains eligible.
On quota exhaustion, try the next eligible entry in the same role's chain, then other configured chat-role primaries and fallback selectors in provider-priority order.
Do not search the unconfigured model catalog.
Do not select zero-quota routes as included funding.
The separate paid Cursor selector requires inspectable credentials, explicitly enabled usable on-demand funding, and no active account block.
Unknown quota or a positive reserve does not authorize paid fallback.
OpenRouter is metered and remains last.
Keep `smol`, `tiny`, and `commit` cheap.
OpenRouter candidates are DeepSeek `deepseek-v4.1-flash` and Zhipu `glm-5.3-flash` for cheap vision, MiniMax `minimax-m3`, Moonshot `kimi-k3` for `slow` and `task`, and Zhipu `glm-5.3`; validate availability with `omp models --json` before using them.
Paid fallback applies to main and task sessions, not auxiliary callers that only read fallback chains.
Recheck included plans at each prompt and return to restored quota even when the paid fallback was pinned.
Cursor has no per-request billing switch; this controls deliberate routing, not server-side overages from stale or unknown usage.

## Apply and verify

```sh
omp config set modelRoles '<json>'
omp config set retry.fallbackChains '<json>'
omp config get modelRoles
omp config get retry.fallbackChains
```

Change the whole setting value; dotted keys within these mappings are not supported.
Read back every changed setting, including `modelProviderOrder` or usage policy when changed.

Paid fallback is opt-in and requires explicit approval to incur Cursor on-demand charges.
The starter config does not enable it.
This setting requires the [patched OMP runtime](https://github.com/MaisonnatM/omp-agents/blob/main/docs/architecture/omp-modules.md); stock OMP `18.12.3` does not support it.
Confirm that `omp config get retry.paidFallback` succeeds before enabling it, then read back the configured selector:

```sh
omp config set retry.paidFallback cursor/claude-opus-5-5
omp config get retry.paidFallback
```

## Role consumers

- `default`: the session model, memory phase 1, and `security-reviewer`, which inherits because it has no model frontmatter.
- `smol`: `scout`, `sonic`, memory phase 2, and prewalk target.
- `slow`: `reviewer`.
- `task`: the bundled `task` agent.
- `plan`: plan mode, `thermonuclear-reviewer`, and `interface-reviewer`.
- `advisor`, `vision`, `commit`, `tiny`: advisor runtime, image turns, commit messages, and titles, memory, and auto-thinking.
