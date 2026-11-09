---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
---

# Phone access goes through Tailscale Serve, with a key per phone

In the context of opening the dashboard on a phone away from home, facing a server that answers only on `127.0.0.1` and signs in with one token that the desktop window holds, we chose Tailscale Serve over a public tunnel and over listening on the LAN, and a key per paired phone over sharing the Mac's token, to keep the dashboard reachable only from the user's own devices and to sign one phone out without touching the others, accepting a Tailscale install and a pairing step.

## Context

The dashboard's guards refuse every host but `127.0.0.1` and `localhost`, and the one token in `~/.config/omp-agents/token` is what every request proves.
A phone elsewhere needs both a way to reach the server and a credential of its own.

## Options considered

- A public tunnel, such as ngrok or Cloudflare Tunnel, reaches the phone from anywhere but puts the dashboard on an address anyone can hit, with the guards as the only thing holding them off.
- Listening on the LAN reaches a phone at home and nothing beyond it, and exposes the server to every device on the network.
- Tailscale Serve proxies one tailnet address to the loopback, so the server still binds `127.0.0.1` and only the user's own devices can open the address.
- Sharing the Mac's token with the phone means losing the phone loses the only credential, and removing it means rotating the token the desktop window uses.
- A key per phone, stored only as a hash, lets **Remove** refuse that phone alone and close its sockets at once.
