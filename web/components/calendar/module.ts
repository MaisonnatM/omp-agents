/** The Calendar module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. */
import { IconCalendarClock } from "central-icons";
import type { PageModule } from "../../modules";
import { GOOGLE_CALENDAR_LOGO } from "../integrations/brand-logos";

/** The Calendar page has one view, so its route holds nothing besides its kind. */
export type CalendarRoute = Record<never, never>;

export const CALENDAR_PAGE: PageModule<"calendar", CalendarRoute, "calendarNewEvent", "calendar.routines.toggle"> = {
	id: "calendar",
	tab: { label: "Calendar", icon: IconCalendarClock, logo: GOOGLE_CALENDAR_LOGO, place: 40 },
	about: "Your month of events, routine runs, and due todos and tickets in one calendar.",
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
