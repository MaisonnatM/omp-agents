# Phone access

Open the dashboard on your phone from anywhere, through Tailscale.

Phone access is off until you turn it on in **Settings › Phone access**.
Turning it on serves the dashboard at `https://<your-mac>.<tailnet>.ts.net` through Tailscale Serve, so only devices on your own tailnet can reach it.
While Tailscale is stopped, signed out, or not installed, the switch stays off and the tab says so, with a link to Tailscale.

**Pair a phone** shows a QR code and its link.
The code works once and expires after five minutes.
Scanning it signs that phone in with its own key, which the phone keeps, and never with this Mac's.
The tab lists each paired phone with when it last connected.
**Remove** signs that phone out at once: its open pages disconnect, and it cannot get back in until you pair it again.

On a paired phone the page hides what only acts on the Mac: the session's Browser tab, the composer's dictation microphone, and the Phone access tab itself.
Turning Phone access off stops the Tailscale address and signs every phone out until you turn it on again.
