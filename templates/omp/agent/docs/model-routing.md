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
When a role's configured chain is exhausted, report quota exhaustion rather than adding Grok or a new metered provider.
Keep `retry.usageAwareFallback` enabled, `retry.usageReservePct: 0`, and `retry.usageReservePolicy: auto`.
The first three providers use coding-plan quota; use any plan with quota left before OpenRouter.
Skip a provider only when it reports zero remaining quota; a plain API key or unknown usage remains eligible.
On quota exhaustion, use the next eligible entry in the same role's chain without reordering providers.
Do not select a provider reporting zero remaining quota as a replacement primary or fallback.
OpenRouter is metered and remains last.
Keep `smol`, `tiny`, and `commit` cheap.
OpenRouter candidates are DeepSeek `deepseek-v4.1-flash` and Zhipu `glm-5.3-flash` for cheap vision, MiniMax `minimax-m3`, Moonshot `kimi-k3` for `slow` and `task`, and Zhipu `glm-5.3`; validate availability with `omp models --json` before using them.

## Apply and verify

```sh
omp config set modelRoles '<json>'
omp config set retry.fallbackChains '<json>'
omp config get modelRoles
omp config get retry.fallbackChains
```

Change the whole setting value; dotted keys within these mappings are not supported.
Read back every changed setting, including `modelProviderOrder` or usage policy when changed.

## Role consumers

- `default`: the session model, memory phase 1, and `security-reviewer`, which inherits because it has no model frontmatter.
- `smol`: `scout`, `sonic`, memory phase 2, and prewalk target.
- `slow`: `reviewer`.
- `task`: the bundled `task` agent.
- `plan`: plan mode and `thermonuclear-reviewer`.
- `advisor`, `vision`, `commit`, `tiny`: advisor runtime, image turns, commit messages, and titles, memory, and auto-thinking.
