---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# Sessions report a Google sign-in loss through an inbox, and the bell asks the user to sign in again

In the context of a Google Calendar or Gmail MCP server answering a session's tool call with HTTP 401, facing agents that retried or tried to sign in themselves while the user never learned the account was signed out, we chose to have the starter kit's `extensions/google-accounts.ts` replace that failure with a text telling the agent not to retry and to ask the user to sign in again in Settings › Integrations, and to leave one report per server per session in `sign-in-inbox/`, which the owner server keeps in `google-accounts.json` and shows in the bell while the account fails a fresh tool list, over watching live sessions' results, a notice per signed-out account, or in-memory reports.
The dashboard never signs in on the user's behalf: the notice only opens Settings › Integrations, accepting that a session must hit the 401 before the bell knows of it.

## Options considered

- The server watches the tool results of the sessions it runs: rejected, since it misses headless `omp -p` sessions and sessions started outside the dashboard, which the kit extension reaches.
- A notice for every Google account whose status reads signed out: rejected, since an account the user signed out on purpose with Remove would nag for good.
- Reports kept in the server's memory: rejected, since a restart, such as an update, would forget the account until a session failed again.
- A kit report through the inbox, kept in `google-accounts.json` until the account works again, its server is gone, or the user signs it out: chosen.

## Consequences

The extension reads the failure's text, `MCP failure` with `code: 401` and the `server:` line, rather than its details, so a call made through an `xd://` device, whose `write` hands on the device's result, is caught as a direct `mcp__` call is.
It names the service by the server's URL host in omp's `mcp.json`, whether or not that server is enabled, and leaves any other server's 401 as it was.
A second report of an account already reported keeps the first one's time, so the notice id `sign-in:<account>:<since>` stays the same and the bell does not toast again.
The sign-in check lists each reported account's tools afresh on the minute tick and after each report, since a list cached before the 401 would read as working, and settles a report whose account answers; there is no check at startup.
Only the server holding `OwnerLock` drains the inbox, as for the other inboxes.

## Confirmation

`templates/omp/extensions.test.ts` feeds the extension a 401 from a Google Calendar server, directly and through `write`, a 401 from another host, a 500, and a non-error result, and checks the replaced text and that one report was left.
`src/server/sign-in-inbox.test.ts` checks the report parser, `src/google-accounts.test.ts` the report and its settling, `src/server/google-accounts-file.test.ts` the file round trip, `src/server/notices.test.ts` the notice, and `web/notice-model.test.ts` its presentation.
