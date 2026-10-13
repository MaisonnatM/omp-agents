import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Notice } from "../../src/shared/notices";
import { NoticeOrigin } from "./notices";

const base = { id: "n", at: 0, seen: false, read: false };
const event = { ...base, kind: "event", title: "Standup", start: 0, end: 1, color: null } as const;

const sourceOf = (notice: Notice) => renderToStaticMarkup(<NoticeOrigin notice={notice} />);

test("a toast names the source of its notice beside that source's logo", () => {
	const slack = sourceOf({ ...base, kind: "slack", from: "Ana", avatarUrl: null, text: "hi", permalink: "https://slack.test", type: "dm", count: 1 });
	expect(slack).toContain(">Slack</span>");
	expect(slack).toContain("2447.6");

	const credits = sourceOf({ ...base, kind: "credits", provider: "anthropic", model: "claude", failures: 1, since: 0, error: "402" });
	expect(credits).toContain(">Anthropic</span>");
	expect(credits).toContain("#D97757");

	const omp = sourceOf({ ...base, kind: "omp", current: "1.0.0", latest: "1.1.0", status: { state: "available" } });
	expect(omp).toContain(">omp</span>");
});

test("an event names Google Calendar only when it comes from a Google calendar", () => {
	expect(sourceOf({ ...event, calendar: "Work", url: "https://calendar.google.com/e" })).toContain(">Google Calendar</span>");
	const local = sourceOf({ ...event, calendar: null, url: null });
	expect(local).toContain(">Calendar</span>");
	expect(local).not.toContain("Google");
});

test("a provider without a known logo still shows its name", () => {
	const html = sourceOf({ ...base, kind: "plan", provider: "acme-cloud", name: "Pro", account: null, windowTitle: "5h", resetsAt: null, resetCredits: 0 });
	expect(html).toContain(">Acme Cloud</span>");
	expect(html).toContain("lucide-gauge");
});
