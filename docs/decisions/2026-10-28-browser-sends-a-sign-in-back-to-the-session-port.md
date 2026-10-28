---
status: accepted
date: 2026-10-28
decision-makers: Maxence
---

# Browser sends a sign-in back to the session's port

In the context of the Browser showing a session's dev server on a free port, facing apps whose sign-in callback names the port they usually run on, such as yampa's `localhost:3000` registered with WorkOS, we chose to have the shell load the same address on the session's port over configuring each app for its port and over running the app on its usual port, so a sign-in works with no app or provider change, accepting that the app cannot send the Browser to another local port the session does not serve.

## Context

[Browser follows sign-ins off this computer](2026-10-28-browser-follows-sign-ins-off-this-computer.md) kept the sign-in in the Browser, but the provider still redirects to the registered callback.
Providers such as WorkOS match callback addresses exactly, so a session's port is not one of them.
Cookies on `localhost` ignore the port, so the callback's cookies reach the session's server either way.

## Options considered

- Have the session point the app's own URL settings at its port: fails whenever the provider accepts only registered callbacks.
- Run the app on its usual port: collides with your own server and with other sessions.
- Map the stray port to the session's port in the shell: chosen.

## Consequences

- `appAddress` in `src/shared/desktop-bridge.ts` decides: a navigation or redirect to a loopback port the session runs nothing on, leaving a page off this computer or on one of the session's ports, goes to the same path on the session's port the guest last showed.
- The page reports the session's ports per guest through `browserPorts`, from the same process list that fills the server menu.
- An app that sends the page to a local port it does not run, such as an API on `:8000`, lands on its own server instead; a typed address is never rewritten.

## Confirmation

`src/shared/desktop-bridge.test.ts` covers `appAddress`; a desktop smoke run sent the guest from `https://example.com` to a callback on a stray port and followed the app's redirect to another stray port, and both ended on the session's port.

## Revisit when

An app needs its Browser page to navigate to another local server it does not run, or the session's process list misses the server the Browser shows.
