# Calendar

- The **Calendar** tab, or a `#calendar` address, shows a month in place of the panes, Monday first.
  The sidebar then lists **Calendar**, then, once Google Calendar is connected, your Google calendars under **My calendars** and **Other calendars**, then **Show routines**, **All**, and each routine by name.
- Each day lists its routine runs, the todos due on it, the events you keep on this computer, and, once connected, the Linear tickets due on it and events of the Google calendars you added.
  A green dot is a run that went through, a red one a run that failed, and a hollow one a run still to come.
  A violet dot is a todo, an amber one a ticket, a timed Google event uses its calendar's color, and an event on this computer is slate gray; an all-day event is a band in that color; a done or canceled todo or ticket is struck through.
- **Show routines** starts checked.
  Uncheck it to hide past, planned, and interval routine entries from the month, day previews, and selected-day list.
  This does not pause routines or hide their sidebar links.
  The app keeps the choice across reloads and shares it between windows on the same dashboard address.
- Planned runs follow each routine's schedules from its last run.
  A time that passed without a run shows as now, since the next minute's check runs it.
  A paused routine shows its past runs and no planned ones.
  A routine that runs more than once a day shows once on each day from today, with how often it runs, instead of each run.
  Only the last 10 runs of a routine are kept, so older months show no past runs.
- A day cell shows three entries and how many more there are; today's number is circled.
  Hover a day, or focus its number, to see all of its entries in a card beside it, each a link like in the day's list.
  Click anywhere in a day's cell to list all of its entries beside the month; today is listed when the page opens.
- Click an entry to open its routine, its todo beside its list, or its ticket; a Google event opens in Google Calendar in your default browser.
  An event on this computer has no page of its own, so clicking it in a day cell lists its day.
- The arrows move a month at a time, the month and year menus jump to any month, and **Today** goes back to the current month.
  Choosing the selected month or year keeps it selected; neither menu clears the calendar's date.
- **New event**, beside **Today**, or C outside a text field, adds an event on the day listed beside the month, or today when none is.
  Type its title, then either check **All day** and pick its first and last days, or pick its day and its start and end times.
  A timed event starts at the next whole hour on today and at 9:00 on another day, and lasts an hour; moving its start moves its end with it, and an end at or before the start shows an error and keeps **Create event** off.
  **Calendar** picks where it goes: one of your Google calendars that the page shows and that you own or may edit, yours first, or **This computer**, which needs no Google sign-in.
  The dialog starts on the calendar you picked last, while it is still offered.
  Enter in the title or Cmd+Enter creates it, and Esc closes the dialog; the month then shows the event and lists its first day.
- An event on **This computer** stays in `events.json` beside the server's access token, so every window of the app shows it, and nothing leaves this computer.
- In the day's list beside the month, an event's trash button deletes it: an event on **This computer**, or a Google event of a calendar you own or may edit.
  It deletes at once, with no confirmation; for a repeating Google event it deletes only that day's repeat.
  An event of a calendar you may only read has no trash button; it opens in Google Calendar.
  To change an event on **This computer**, delete it and add it again; a Google event is changed in Google Calendar, which its entry opens.
- To show Google events, connect Google Calendar in **Settings › Integrations**; see [Integrations](integrations.md).
  The sidebar lists the calendars checked in Google Calendar's own list, the ones you own under **My calendars** and the ones you subscribed to or others share under **Other calendars**, as Google Calendar groups them.
  Each has a checkbox in its color: uncheck one to hide its events on this page, and check it to show them again; the month updates at once.
  The checkbox flips immediately and waits for the save and event refresh before taking another click.
  A failed save restores its previous value and shows the error.
  The server keeps the choice in `calendars.json` beside its access token, so every window of the app shows the same calendars.
  A calendar unchecked in Google Calendar's own list is not listed; check it there first.
  The page leaves out canceled events, the ones you declined, and working locations, repeats multi-day events on each day, and refreshes the open month every minute.
