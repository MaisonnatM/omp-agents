# Pins

The sidebar's pins are a list of session ids that the server keeps, so every window agrees.
`src/server/pins-file.ts` keeps them in `pins.json` beside the access token, as `{ sessions }`, and moves a file that holds anything else to `pins.json.invalid`.
A `pin` socket message carries a `PinChange`, `{ op, sessionIds }` with `op` one of `pin` and `unpin`, checked in `src/server/wire.ts`.
`applyPins` in `src/shared/pins.ts` applies it, and never toggles, so the same change sent twice pins or unpins once.
Every socket hears the pins after each change as a `pins` message on the roster topic, also sent when a socket opens; a change that changes nothing sends the pins back to its own socket alone.
The page shows a change before the server answers, and its **Pin** and **Unpin** send `pin` or `unpin` from the pins it holds.
Pins an older page kept in localStorage, under `omp-agents.pinned-sessions`, go to the server as one `pin` the first time the page hears the pins, and the key is then removed.
Each server keeps its own copy in memory, as with the workspaces.
