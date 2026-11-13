// The `user_event` tool: lets an agent list the upcoming events kept on this computer on the omp-agents dashboard's
// Calendar page, add a reminder, and remove one it added. Changes go to the dashboard's event inbox, one file each,
// which the dashboard server applies and deletes, so it stays the only writer of events.json and a reminder added while
// it is down waits for it.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_DIR, inbox, readJson, reply, withoutEmpty } from "./inbox/client";

const EVENTS_FILE = join(CONFIG_DIR, "events.json");
const INBOX = inbox<Change>(join(CONFIG_DIR, "event-inbox"));

// The shape of LocalEvent in src/shared/calendar.ts, which this file cannot import: change it with that one.
type EventWhen = { allDay: true; firstDay: string; lastDay: string } | { allDay: false; start: number; end: number };
interface LocalEvent {
	id: string;
	title: string;
	when: EventWhen;
	sessionId: string | null;
}
type Change = { op: "add"; event: LocalEvent } | { op: "remove"; id: string; sessionId: string };

/** A date-time with a time of day, and an offset or none; `Date.parse` reads one without an offset as local time. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const MINUTE_MS = 60_000;

/** Pending changes participate in reads so agents see their writes while the dashboard is stopped. */
function readEvents(): LocalEvent[] {
	const events = new Map(((readJson(EVENTS_FILE) as { events?: LocalEvent[] } | null)?.events ?? []).map(event => [event.id, event]));
	for (const change of INBOX.waiting()) {
		if (change.op === "add" && !events.has(change.event.id)) events.set(change.event.id, change.event);
		if (change.op === "remove") events.delete(change.id);
	}
	return [...events.values()];
}

/** The local midnight starting `day`, `YYYY-MM-DD`, `after` days later. */
function midnight(day: string, after = 0): number {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(year!, month! - 1, date! + after).getTime();
}

/** When `when` starts and ends, epoch ms; an all-day event ends at the local midnight after its last day. */
const span = (when: EventWhen): [number, number] => (when.allDay ? [midnight(when.firstDay), midnight(when.lastDay, 1)] : [when.start, when.end]);

const localTime = (ms: number): string => new Date(ms).toLocaleString("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function whenText(when: EventWhen): string {
	if (!when.allDay) return `${localTime(when.start)} to ${localTime(when.end)}`;
	return when.firstDay === when.lastDay ? `${when.firstDay}, all day` : `${when.firstDay} to ${when.lastDay}, all day`;
}

/** One line per event that has not ended, the soonest first. */
function listText(sessionId: string): string {
	const now = Date.now();
	const lines = readEvents()
		.map(event => ({ event, span: span(event.when) }))
		.filter(({ span: [, end] }) => end > now)
		.sort((a, b) => a.span[0] - b.span[0])
		.map(({ event }) => `- ${event.title} (id ${event.id}, ${whenText(event.when)}${event.sessionId === sessionId ? ", added by this session" : ""})`);
	return lines.length > 0 ? lines.join("\n") : "No upcoming event is kept on this computer.";
}

export default function events(pi: ExtensionAPI) {
	// Reminders belong to the user's session, so a subagent's requests leave out this tool's schema.
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind === "sub") await pi.setActiveTools(pi.getActiveTools().filter(name => name !== "user_event"));
	});
	const z = pi.zod;
	const params = z.object({
		action: z.enum(["list", "add", "remove"]).describe("list the upcoming events, add a reminder, or remove one this session added"),
		id: z.string().max(64).optional().describe("remove: the event's id, from list"),
		title: z.string().max(200).optional().describe("add: what to check or do, one line"),
		start: z.string().max(64).optional().describe("add: when it starts, an ISO 8601 date-time such as 2026-11-05T14:30; without an offset it is local time"),
		minutes: z.number().int().min(5).max(1440).optional().describe("add: how long it lasts, in minutes; 30 if omitted"),
	});
	pi.registerTool({
		loadMode: "essential",
		name: "user_event",
		label: "User event",
		description: [
			"Reminders on the omp-agents dashboard's Calendar page, kept on this computer.",
			"The event shows on the Calendar page and a notice comes 10 minutes before it starts; clicking either opens this session.",
			"Add one when the user asks for a reminder, or when the result of your work can only be checked later and checking it could change a decision, such as keeping or reverting a change.",
			"Rules:",
			"- Start it when the result can first be seen, such as after the next deploy or once a day of metrics has come in, and say in your reply why you picked that time.",
			"- Add at most one per task; never add one only because work was merged or finished.",
			"- Name the reminder and its time in your reply.",
			"Add one, for example:",
			"- A query optimization merged today; the latency dashboard needs a day of traffic: tomorrow 10:00, \"Check p95 latency of /search after the index change\".",
			"- A fix deployed tonight; the error it targets fires a few times a day: tomorrow 9:30, \"Check Sentry for TimeoutError since the retry fix\".",
			"- A flaky test was quarantined; CI runs it nightly: in two days, \"Check whether the quarantined checkout test passed three nights in a row\".",
			"- The user says \"remind me Friday to follow up with Ana\": Friday 9:00, that title.",
			"Do not add one, for example:",
			"- Tests passed and the PR is open: nothing waits on time; the user reviews it anyway.",
			"- A step the user must take with no time attached, such as setting up an account: that is user_todo.",
			"- A finding to keep: that is user_note.",
			"You can remove only the events this session added.",
		].join("\n"),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(withoutEmpty(raw));
			if (!parsed.success) return reply("Invalid user_event input.", true);
			const { action, id, title, start, minutes = 30 } = parsed.data;
			const sessionId = ctx.sessionManager.getSessionId();
			switch (action) {
				case "list":
					return reply(listText(sessionId));
				case "add": {
					const line = title?.replace(/\s+/g, " ").trim();
					if (!line) return reply("add needs a title.", true);
					const startMs = start && DATE_TIME.test(start) ? Date.parse(start) : Number.NaN;
					if (Number.isNaN(startMs)) return reply("add needs a start, an ISO 8601 date-time such as 2026-11-05T14:30.", true);
					if (startMs < Date.now()) return reply(`${start} is in the past; give a start from now on.`, true);
					const same = readEvents().find(event => event.sessionId === sessionId && event.title === line && !event.when.allDay && event.when.start === startMs);
					if (same) return reply(`This session already added it (id ${same.id}).`);
					const event: LocalEvent = { id: randomUUID(), title: line, when: { allDay: false, start: startMs, end: startMs + minutes * MINUTE_MS }, sessionId };
					INBOX.leave({ op: "add", event });
					return reply(`Added to the Calendar page (id ${event.id}), ${whenText(event.when)}; a notice comes 10 minutes before it starts.`);
				}
				case "remove": {
					const event = readEvents().find(entry => entry.id === id);
					if (!event) return reply(`No event kept on this computer has id ${id ?? "(none given)"}.`, true);
					if (event.sessionId !== sessionId) return reply(`This session did not add ${JSON.stringify(event.title)}, so it cannot remove it.`, true);
					INBOX.leave({ op: "remove", id: event.id, sessionId });
					return reply(`Removed ${JSON.stringify(event.title)} from the Calendar page.`);
				}
			}
		},
	});
}
