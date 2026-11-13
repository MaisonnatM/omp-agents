/** The Sport module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/architecture/sport.md. */
import { IconDumbell } from "central-icons";
import { isDay } from "../../../src/json";
import type { SportChange, SportState } from "../../../src/shared/sport";
import { applySportChanges } from "../../../src/sport";
import type { StoredPageModule } from "../../modules";

/**
 * The Sport page's tab: the week with day `day` open (`null` for today), the journal with log `open` beside it (`null` for
 * none), or the progress charts.
 */
export type SportRoute = { tab: "week"; day: string | null } | { tab: "journal"; open: string | null } | { tab: "progress" };

type SportShortcutId =
	| "sportPreviousDay"
	| "sportNextDay"
	| "sportPreviousDemo"
	| "sportNextDemo"
	| "sportJournalNext"
	| "sportJournalPrevious"
	| "sportJournalClose"
	| "sportTimerPause"
	| "sportTimerPrevious"
	| "sportTimerNext";

export type SportControlId =
	| "sport.tab.week"
	| "sport.tab.journal"
	| "sport.tab.progress"
	| "sport.week.step"
	| "sport.log.open"
	| "sport.log.free"
	| "sport.log.save"
	| "sport.demo.open"
	| "sport.demo.play"
	| "sport.demo.step"
	| "sport.day.edit"
	| "sport.journal.edit"
	| "sport.journal.remove"
	| "sport.weigh.open"
	| "sport.weigh.save"
	| "sport.progress.card"
	| "sport.progress.range"
	| "sport.timer.open"
	| "sport.timer.pause"
	| "sport.timer.step"
	| "sport.timer.sound"
	| "sport.timer.close";

export const SPORT_PAGE: StoredPageModule<"sport", SportRoute, SportState, SportChange[], SportShortcutId, SportControlId> = {
	id: "sport",
	tab: { label: "Sport", icon: IconDumbell, place: 60 },
	home: { tab: "week", day: null },
	/** `#sport` is this week, `?day=<YYYY-MM-DD>` that day's week with that day open, `#sport/journal` the workout journal, `?open=<log id>` with that log open, and `#sport/progress` the progress charts. */
	address: {
		parse(rest, query) {
			if (rest === "journal") return { tab: "journal", open: query.get("open") || null };
			if (rest === "progress") return { tab: "progress" };
			const day = query.get("day");
			return { tab: "week", day: isDay(day) ? day : null };
		},
		rest: route => (route.tab === "week" ? null : route.tab),
		query(route) {
			if (route.tab === "week") return route.day === null ? null : `day=${route.day}`;
			return route.tab === "journal" && route.open !== null ? `open=${encodeURIComponent(route.open)}` : null;
		},
	},
	title: () => "Sport",
	views: [
		{ key: "sport", label: "Sport week" },
		{ key: "sport/journal", label: "Sport journal" },
		{ key: "sport/journal/item", label: "A workout log" },
		{ key: "sport/progress", label: "Sport progress" },
	],
	view(route) {
		if (route.tab === "week") return "sport";
		if (route.tab === "progress") return "sport/progress";
		return route.open === null ? "sport/journal" : "sport/journal/item";
	},
	shortcuts: {
		category: "Sport",
		goTo: { label: "Go to your sport week", command: "Go to sport", keys: [] },
		rows: [
			{ id: "sportPreviousDay", label: "Sport week: open the day before", keys: [{ chord: { key: "ArrowLeft" }, scope: "outside-fields" }] },
			{ id: "sportNextDay", label: "Sport week: open the day after", keys: [{ chord: { key: "ArrowRight" }, scope: "outside-fields" }] },
			{ id: "sportPreviousDemo", label: "Sport demo: show the workout's previous demo", keys: [{ chord: { key: "ArrowLeft" }, scope: "outside-fields" }] },
			{ id: "sportNextDemo", label: "Sport demo: show the workout's next demo", keys: [{ chord: { key: "ArrowRight" }, scope: "outside-fields" }] },
			{
				id: "sportJournalNext",
				label: "Sport journal: focus the next, older session, or open it while a session is open",
				keys: [
					{ chord: { key: "ArrowDown" }, scope: "outside-fields" },
					{ chord: { key: "j" }, scope: "outside-fields" },
				],
			},
			{
				id: "sportJournalPrevious",
				label: "Sport journal: focus the previous, newer session, or open it while a session is open",
				keys: [
					{ chord: { key: "ArrowUp" }, scope: "outside-fields" },
					{ chord: { key: "k" }, scope: "outside-fields" },
				],
			},
			{ id: "sportJournalClose", label: "Sport journal: close the open session", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
			{ id: "sportTimerPause", label: "Sport timer: pause or resume the routine", keys: [{ chord: { key: " " }, scope: "outside-fields" }] },
			{ id: "sportTimerPrevious", label: "Sport timer: go back to the previous step", keys: [{ chord: { key: "ArrowLeft" }, scope: "outside-fields" }] },
			{ id: "sportTimerNext", label: "Sport timer: end this step and go to the next", keys: [{ chord: { key: "ArrowRight" }, scope: "outside-fields" }] },
		],
	},
	controls: [
		{ id: "sport.tab.week", label: "Sport Semaine tab", area: "Sport" },
		{ id: "sport.tab.journal", label: "Sport Journal tab", area: "Sport" },
		{ id: "sport.tab.progress", label: "Sport Progrès tab", area: "Sport" },
		{ id: "sport.week.step", label: "Sport previous and next week buttons", area: "Sport" },
		{ id: "sport.log.open", label: "Sport Fait button", area: "Sport" },
		{ id: "sport.log.free", label: "Sport Séance libre button, in the header or on a rest day", area: "Sport" },
		{ id: "sport.log.save", label: "Sport log Enregistrer button", area: "Sport" },
		{ id: "sport.demo.open", label: "Sport demo thumbnail and exercise link", area: "Sport" },
		{ id: "sport.demo.play", label: "Sport demo play button", area: "Sport" },
		{ id: "sport.demo.step", label: "Sport demo dialog Précédent and Suivant buttons", area: "Sport" },
		{ id: "sport.day.edit", label: "Sport day Modifier button", area: "Sport" },
		{ id: "sport.journal.edit", label: "Sport journal Modifier button", area: "Sport" },
		{ id: "sport.journal.remove", label: "Sport journal Supprimer button", area: "Sport" },
		{ id: "sport.weigh.open", label: "Sport Pesée button", area: "Sport" },
		{ id: "sport.weigh.save", label: "Sport Pesée Enregistrer button", area: "Sport" },
		{ id: "sport.progress.card", label: "Sport progress card", area: "Sport" },
		{ id: "sport.progress.range", label: "Sport progress range tabs", area: "Sport" },
		{ id: "sport.timer.open", label: "Sport routine Lancer button", area: "Sport" },
		{ id: "sport.timer.pause", label: "Sport timer pause and resume button", area: "Sport" },
		{ id: "sport.timer.step", label: "Sport timer previous and next step buttons", area: "Sport" },
		{ id: "sport.timer.sound", label: "Sport timer sound toggle", area: "Sport" },
		{ id: "sport.timer.close", label: "Sport timer Fermer button on the done screen", area: "Sport" },
	],
	store: {
		apply(state, changes) {
			const applied = applySportChanges(state, changes);
			return "ok" in applied ? applied.ok : null;
		},
	},
};
