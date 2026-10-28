---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Browser follows sign-ins off this computer

In the context of the Browser's webview, facing apps whose sign-in redirects to a provider such as Google or WorkOS, or opens it in a popup, we chose to let the guest follow any web address in place and open feature-sized popups as in-app windows in the Browser's partition, over handing every off-computer navigation and new window to the default browser, so the sign-in's cookies and callback land in the Browser that shows the app, accepting that the guest can show any site and that picks must be checked against the guest's address.

## Context

[Preview embeds the session's app in a webview](2026-10-28-preview-embeds-the-session-app-in-a-webview.md) sent every navigation off this computer to `shell.openExternal`.
A redirect sign-in then finished in the default browser, whose cookies the Browser never sees, and a popup sign-in lost its `window.opener`.
The guest runs sandboxed in `persist:omp-preview` with no permissions beyond clipboard writes, and its preload forwards any page's pick message to the composer.

## Options considered

- Keep the guest on loopback and open the rest outside: the sign-in never completes in the Browser.
- Allow only a list of known sign-in providers: every app's provider would need adding, and a provider's own redirects change.
- Follow any web address in place, popups with window features in an in-app window, `target="_blank"` links outside: chosen.

## Consequences

- Signing in works in the Browser for redirect and popup flows.
- The address field still loads only loopback addresses, and only a loopback address is saved as the session's last address.
- `web/use-webview.ts` appends a pick only while the guest shows a loopback page.
- An app whose sign-in callback names another port, such as `localhost:3000`, lands on that port, not on the session's dev server.

## Confirmation

A desktop smoke run with a loopback fixture app checked that a redirect to `https://example.com` stays in the guest, a `window.open` with features opens a child window in `persist:omp-preview` with `window.opener` set, a `target="_blank"` link reaches `shell.openExternal`, and a pick posted from `https://example.com` does not reach the composer.

## Revisit when

An app needs a sign-in flow that opens a tab rather than a popup, or the guest gains a permission that a third-party site should not get.
