# HTTP API: Google Calendar

`src/google-calendar.ts` reads and writes Google Calendar's REST API (`https://www.googleapis.com/calendar/v3`) with the token omp holds for each account's Google Calendar MCP server, so the Calendar page needs no sign-in of its own.
Google Calendar's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested the same scopes.
Each `GoogleCalendarClient` and each `GmailClient` reads with its account's sign-in, through the `SignedFetch` that `accountClients` in `src/google-accounts.ts` hands it; Slack's check calls `integrationFetch("slack")` in `src/integrations.ts`, which signs with the service's first server.
Both are `signedFetch` in `src/signed-fetch.ts`, which knows nothing of omp, over `mcpBearer` in `src/omp/mcp.ts`, the token omp holds for that server.
`signedFetch` sends that token with a GET, or, given an `ApiWrite`, with a POST of its `body` as JSON or a DELETE.
A 401 throws the bearer's refusal: `mcpBearer`'s forgets the token and the tool list and throws `McpRefused`.
Any other failure throws an `ApiError` from `src/signed-fetch.ts` with the answer's status and the API's `error.message`.
An empty answer, such as a 204, is `null`.
`GET /api/google` answers a `GoogleStatus`, `{ calendars, failed }`: the calendars checked in each signed-in account's Google Calendar list (`calendarList`, `selected`), each with its `account`, its id, the name you gave it or else its own, its color, its `group`, its `writable` flag, its `shown` flag, and the error of its last read, and in `failed` each account whose list could not be read, with why.
`GoogleCalendars` reads every account's list at once, so one failing account leaves the others' calendars in the answer.
`group` is `mine` for a calendar whose `accessRole` is `owner`, Google Calendar's **My calendars**, and `other` for the rest, its **Other calendars**.
`writable` is true for an `accessRole` of `owner` or `writer`, the calendars a new event may go in.
`shown` is false for a calendar unchecked in the Calendar page's sidebar.
`PUT /api/google/calendars` takes `{ account, id, shown }`, checked by `parseCalendarShown` in `src/server/wire.ts`, saves the choice in `calendars.json`, and answers the calendars as `GET /api/google` does.
`src/server/calendars-file.ts` keeps there, as `{ hidden }`, each account's hidden calendar ids by its server's name, and each account's `GoogleCalendarClient` reads its own set on each call.
A file from before accounts holds one list of ids, the first Google Calendar server's whatever its name; it waits under the key `""`, which names no server, until the dashboard's start gives it to the first server on `calendarmcp.googleapis.com`.
With no calendar checked in an account's Google Calendar list, that account's events read is an error that asks you to check one there; with every checked calendar hidden in the sidebar, it answers no events.
`GET /api/calendar/events?from=<ISO time>&to=<ISO time>` reads at most 62 days of every signed-in account, and reads each account's list and each shown calendar's events at most once a minute, unless `fresh` asks again; a hidden calendar's events are not read.
An account whose events cannot be read is left out of the answer while another answers, and only when none can is the answer an error.
Each calendar's `events` read uses `singleEvents=true`, so Google expands repeating events with their removed and moved repeats, and follows `nextPageToken` to the last page.
Canceled events, events you declined, working-location events, and events with no length are left out, and Google's exclusive all-day end becomes the last included day.
An event carries its `account`, its calendar's id, Google's event id, which differs for each repeat, and its calendar's `writable` flag, and it links to the event in Google Calendar.
One calendar that cannot be read keeps its error for the Integrations row while the others still answer; only when none of an account's can is that account's read an error.
The Calendar page reads the open month's events through `calendarEventsStore` in `web/reads.ts` every minute while any Google Calendar account's connection is `ready` or `failing`, and puts a multi-day event on each day it covers.
It shows the calendars and events of the accounts `visibleAccounts` keeps for the sidebar's workspace, grouped in its sidebar under each account's address.
The Calendar tab's sidebar reads the calendars through `googleStore`, and a checkbox's `PUT` reads both stores again, so the open month changes at once.
Each successful calendar save merges that calendar's confirmed visibility into `googleStore` before rereading, so an aborted or failed refresh cannot undo it.
The server deletes the `google.json` that an older version kept the calendars' secret iCal addresses in when it starts.

## New and local events

`PUT /api/calendar/events/new` takes a `NewEvent`, `{ title, when, calendar }`, checked by `parseNewEvent` in `src/server/wire.ts`, and answers a `NewEventAnswer`, `{ kept }`: the event as kept on this computer, or `null` for one added to Google Calendar.
The title is trimmed, nonempty, and at most 500 characters; `when` is `{ allDay: true, firstDay, lastDay }` with `YYYY-MM-DD` days, the last not before the first, or `{ allDay: false, start, end }` in epoch milliseconds with the end after the start.
`calendar`, a `NewEventCalendar`, is `{ kind: "local" }` or `{ kind: "google", account, calendarId }`, and the new-event dialog offers only the calendars of the accounts the page shows.
A Google calendar goes through `GoogleCalendarClient.create`, which refuses a calendar not checked in your Google Calendar's list or not `writable`, and otherwise posts the event to the calendar's `events` with its `summary` and `start` and `end`: `{ date }` for an all-day event, whose end Google takes as the day after the last, or `{ dateTime }` in ISO time.
It then forgets that calendar's kept event reads, which the client keeps per calendar, so the next read shows the event.
This computer adds the event to `events.json` beside the access token, through `LocalEventsFile` in `src/server/local-events-file.ts`, with a `crypto.randomUUID()` id; a file it cannot read moves to `events.json.invalid`.
`parseEventWhen` in `src/shared/calendar.ts` checks an event's `when` both for `parseNewEvent` and for each event that file keeps.
`GET /api/calendar/local` answers every kept event, since only what you typed by hand is there, and the page lays out the days of the month it shows.
`PUT /api/calendar/events/delete` takes an `EventRef`, checked by `parseEventRef`: `{ kind: "local", id }` deletes that kept event if it is still there, and `{ kind: "google", account, calendarId, eventId }` goes through that account's `GoogleCalendarClient.delete`; it answers `{}`.
`GoogleCalendarClient.delete` refuses a calendar not checked in your Google Calendar's list or not `writable` before asking Google, as `create` does, and otherwise sends a DELETE to the event's address under the calendar's `events`, without `sendUpdates`.
The client counts an `ApiError` of 404 or 410 as deleted, since Google answers 410 for an event deleted a moment ago and 404 once it is purged, so deleting twice ends the same way.
A repeat's event id deletes only that repeat; the client then forgets that calendar's kept event reads, so the next read leaves the event out.
The Calendar page reads the kept events through `localEventsStore` in `web/reads.ts` every minute, with or without Google Calendar.
The page owns what a write changes: it adds the kept event that `PUT /api/calendar/events/new` answers to that store, or reads the month of an event added to Google Calendar again; after a delete it takes a kept event out of `localEventsStore`, or reads the open month's events again, and the delete button stays busy until that read settles.
