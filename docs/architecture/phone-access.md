# Phone access

How the dashboard reaches a paired phone, and how that phone proves itself.

The server keeps binding `127.0.0.1`.
Tailscale Serve proxies `https://<dns>:443` to `http://127.0.0.1:<port>`, so the server never listens outside the machine.
`tailscaleOver` in `src/server/tailscale.ts` runs the CLI, found at `/usr/local/bin/tailscale` or in the Tailscale app bundle, since the desktop app's PATH may hold neither.
It reads the DNS name from `tailscale status --json` (`BackendState` of `Running`, `Self.DNSName` without its trailing dot) and serves with `tailscale serve --bg --https=443`.
Turning Phone access on while https 443 already proxies somewhere else refuses with 409 rather than replacing that config, and turning it off runs `tailscale serve --https=443 off`.
`OMP_AGENTS_TAILSCALE_DNS` stands in for the whole CLI, so a smoke server names its tailnet and turns Phone access on without Tailscale running or its serve config changing.

`PhoneAccess` in `src/server/phone-access.ts` keeps `{ enabled, dnsName, phones }` in `phone-access.json` beside the token file, mode 0600.
Each phone is `{ id, name, tokenHash, mediaKeyHash, pairedAt, lastSeenAt }`: the token's sha256 and the sha256 of `mediaKey(token)`, never the token.
A pairing code is 32 random bytes, kept in memory only, hashed, single use, and dead after five minutes.
`POST /api/phone-access/pair` takes `{ code, name }` with no token, and only from the tailnet host with the matching `https://` origin; the code arrives in the page's `#pair=` fragment, which the server never sees.
A wrong, used, or expired code answers the same 401, and a host that tries eight in five minutes gets nothing more.

`guardsFor` in `src/server/http.ts` accepts the tailnet host, and `https://` as its origin, only while Phone access is on, and a phone's token only while that phone is still paired.
A phone's request updates `lastSeenAt`, at most once a minute.
The state, enable, pairing, and removal routes go through `writeBodyLocal`, which takes the main token on a loopback host and answers 403 to a phone's token.
Removing a phone closes the dashboard and terminal sockets it signed in on, which the server tracks by the phone id stamped on each socket at upgrade.
With Phone access off, the tailnet host is a forbidden host and every phone's token is refused.
