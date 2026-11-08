---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# Subagents drop the user's session tools when they start

In the context of the starter kit's extension tools, which omp loads again in every task subagent, facing six tools that act for the user's session (`end_session`, `land`, `ship_stage`, `user_todo`, `user_note`, `user_event`) riding in every subagent request at about 2,600 tokens, unused by subagents in 30 days, we chose to have each owning extension remove its own tool from the active set in a `session_start` handler when `ctx.agent.kind` is `sub`.
We rejected one central extension that lists the six names, `defaultInactive` on each tool turned on in the main session, rewriting the payload in `before_provider_request`, and mounting the tools as `xd://` devices.
This saves about $20 per 14 days and keeps the rule beside the tool it governs, accepting six small handlers and a schema a subagent cannot ask for.

## Options considered

- One central extension with the list: one place to read, but a new tool's author must know the list exists, and it reaches into other files' tools.
- `defaultInactive` plus turning the tool on in the main session: if that step fails, the user's own session loses the tool.
- Payload rewrite: per provider format, and omp's prompt would still list the removed tools.
- `xd://` devices in subagents: keeps a catalog line each and a way to call tools a subagent must not use.
- Per-extension `session_start` removal: chosen; omp runs the handlers one after another, so they do not race, and a failure leaves the tool as before.

## Confirmation

`omp -p --no-extensions` with the six extensions and `scripts/token-audit/dump-request.ts`, asked to spawn a scout, sent the scout 11 tools in 14.6k chars before and 5 tools in 5.2k chars after, while the main session kept all six.
`land` and `end_session` still refuse a subagent's call, for an agent file that names the tool.
