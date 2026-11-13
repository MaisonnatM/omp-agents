/** The Calendar module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. */
import { IconCalendarClock } from "central-icons";
import type { PageModule } from "../../modules";

/** The Calendar page has one view, so its route holds nothing besides its kind. */
export type CalendarRoute = Record<never, never>;

export const CALENDAR_PAGE: PageModule<"calendar", CalendarRoute, "calendarNewEvent", "calendar.routines.toggle"> = {
	id: "calendar",
	tab: { label: "Calendar", icon: IconCalendarClock, place: 40 },
	home: {},
	/** `#calendar` is a month of routine runs, due todos, and due tickets; nothing follows it. */
	address: { parse: () => ({}), rest: () => null, query: () => null },
	title: () => "Calendar",
	views: [{ key: "calendar", label: "Calendar" }],
	view: () => "calendar",
	shortcuts: {
		category: "Calendar",
		goTo: { label: "Go to your calendar", command: "Go to calendar", keys: [] },
		rows: [{ id: "calendarNewEvent", label: "Calendar: add an event", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] }],
	},
	controls: [{ id: "calendar.routines.toggle", label: "Calendar routine visibility", area: "Calendar" }],
};
