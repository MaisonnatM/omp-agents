# Preferences

The page's choices that describe the user rather than the machine follow the user through [Settings sync](settings-sync.md), so the server keeps them, and each page keeps its localStorage as the copy it paints from first.
`PORTABLE_PREFERENCES` in `src/shared/preferences.ts` names them by localStorage key: the theme, **Show tool calls** and **Show thinking**, the sidebar tabs, the pinned skill, session notifications with their finished-turn, sound, and focused-sound choices, the default merge method, the Code tab's layout, wrap, and whitespace choices, and whether the Calendar shows routines.
Every other key stays on its machine: widths, splits, open panels, folds, drafts, caches, the command palette's frecency, the last merge method, team, and calendar, and the pull requests already seen.

`src/server/preferences-file.ts` keeps them in `preferences.json` beside the access token, as `{ values }`, each value the raw string the page stores, and moves a file that holds anything else, a key this version does not carry included, to `preferences.json.invalid`.
No file means no page has handed the server its preferences yet, and the server sends `values: null`.
A `preference` socket message carries a `PreferenceChange`, checked in `src/server/wire.ts`, which refuses a key outside the list and a value that is not a string.
`set` stores one key's string, or removes the key with `null`, which the page sends for a value back at its default.
`seed` hands the server every portable key the page holds, and `applyPreference` takes it only while the server holds none, so the first page to connect after an upgrade wins and a later seed changes nothing.
Every socket hears the preferences after each change as a `preferences` message on the roster topic, also sent when a socket opens; a change that changes nothing sends them back to its own socket alone.

On the page, `storeOrRemove` in `web/stored-state.ts`, which every `useStoredState` setter writes through, sends a portable key's change as `set` through the sender `web/use-dashboard.ts` registers with `sendPreferencesThrough`.
A `preferences` message with `null` makes the page send `seed` with what its localStorage holds, and any other replaces the page's values through `adoptPreferences`, which writes localStorage and the shared snapshot directly, so nothing it takes goes back to the server, and wakes only the keys whose value changed.
`startTheme` in `web/theme.ts` applies the theme on every write of its key, so a theme that arrives from the server, or from another page, shows at once; every other key is read through `useStoredState`, or, for the pinned skill, from localStorage when a session starts.
A change made while the socket is closed reaches no server, and the snapshot the next socket brings replaces it, as for the todos and the pins.
