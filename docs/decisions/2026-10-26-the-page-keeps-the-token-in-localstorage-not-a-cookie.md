---
status: accepted
date: 2026-10-26
decision-makers: Maxence Maisonnat
---

# The page keeps the token in localStorage, not a cookie

The desktop window's preload writes the token into the dashboard origin's `localStorage`, and the page sends it as `Authorization: Bearer`, or as the socket's `bearer.<token>` subprotocol.
Browsers send a cookie for `127.0.0.1` to every port of that host, so any program listening on another port could log it; `localStorage` belongs to one port.
An image, a video, or the mail frame cannot send a header, so their addresses carry a media key, an HMAC of the token that opens only those routes.
The desktop shell checks a nonce's HMAC from `/api/hello` before it sends the token to whatever answers on the port.
See [SECURITY.md](../../SECURITY.md) and [Desktop shell](../architecture/desktop-shell.md).
