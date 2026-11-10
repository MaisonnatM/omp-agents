---
status: accepted
date: 2026-11-10
decision-makers: agent
---

# Another server's page opens in an app of its own

In the context of agents handing off their smoke servers' dashboard addresses, facing links that open on the signed-out page in the default browser and in the Browser's tabs, we chose to open such a page in a desktop app instance of its own for that port, over signing in the Browser's guest or a browser tab, so the token stays where [The dashboard runs only in the desktop app](2026-10-26-the-dashboard-runs-only-in-the-desktop-app.md) and [Preview embeds the session's app in a webview](2026-10-28-preview-embeds-the-session-app-in-a-webview.md) keep it, accepting one more app process per smoke server and one window per server.

## Context

A smoke server that keeps the user's token is an omp-agents server like the user's own, on another port.
Its page signs in only from the localStorage entries that the desktop shell's preload writes for its own port, so its address shows **Open the omp agents app** everywhere else.
The app already keeps its data and single-instance lock per port, and attaches to an omp-agents server that answers `helloProof` for its token.

## Options considered

- A new app instance for that port, launched with the page's address: reuses the per-port instance and the `helloProof` check, and gives the token to no new place; one instance has one window, so several pages of one server share it.
- The Browser's guest, signed in by the shell: shows each page as a tab, but writes the token into the `persist:omp-preview` partition's localStorage for that origin, where any later dev server on the same port, from the same 20000 to 39999 range, reads it.
- The default browser, signed in by an address that carries the token: works in any browser, but puts the token in history, logs, and the clipboard, which the dashboard's security model refuses.

## Consequences

Clicking a smoke server's link in a reply, or **Review visuals** on its pages, opens the dashboard signed in.
Such an instance starts no server, so it never shows a server other than the one the link named.
A smoke server on isolated state holds another token, fails the check, and still opens signed out in the default browser or a tab.

## Confirmation

A headless desktop smoke opens a smoke server's past-session address from another instance's `openDashboard`, and a `target="_blank"` link to it, and checks that the instance of that port shows the page signed in, while a loopback address of no omp-agents server goes to `shell.openExternal`.

## Revisit when

Revisit when the page can sign in without the shell's preload, or when one instance can hold several windows.
