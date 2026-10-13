import { expect, test } from "bun:test";
import type { Notice } from "../src/shared/notices";
import { presentNotice, TOAST_MS } from "./notice-model";

const NOW = 1791000000000;
const flags = { at: NOW, seen: false, read: false };

test("a Slack message opens in Slack and toasts briefly", () => {
	const shown = presentNotice({ id: "s", ...flags, kind: "slack", from: "Ann", avatarUrl: null, text: "hi", permalink: "https://slack/x", type: "dm", count: 2 }, NOW);
	expect(shown).toMatchObject({ source: "slack", headline: "Ann sent you 2 messages", preview: "hi", link: { href: "https://slack/x", external: true }, action: { kind: "none" }, toast: { kind: "news", timeout: TOAST_MS } });
});

test("an event stays toasted and opens the Calendar page when kept on this computer", () => {
	const shown = presentNotice({ id: "e", ...flags, kind: "event", title: "Standup", start: NOW + 60_000, end: NOW + 600_000, calendar: null, color: null, url: null }, NOW);
	expect(shown.source).toBe("calendar");
	expect(shown.headline).toStartWith("Standup starts at");
	expect(shown.link?.external).toBe(false);
	expect(shown.toast).toEqual({ kind: "news", timeout: 0 });
});

test("an update's action, failure, and toast follow its status", () => {
	const update = (status: Extract<Notice, { kind: "omp" }>["status"], seen = false): Notice => ({ id: "u", ...flags, seen, kind: "omp", current: "1", latest: "2", status });
	expect(presentNotice(update({ state: "available" }, true), NOW)).toMatchObject({ source: "updates", headline: "omp 2 is out", link: null, action: { kind: "update", label: "Update", ready: true }, toast: { kind: "update", dismissedElsewhere: true } });
	expect(presentNotice(update({ state: "updating" }), NOW)).toMatchObject({ busy: true, action: { label: "Updating", ready: false } });
	expect(presentNotice(update({ state: "failed", error: "boom" }), NOW)).toMatchObject({ failed: true, preview: "boom", action: { ready: true } });
	expect(presentNotice(update({ state: "updated", note: "done" }), NOW).action).toEqual({ kind: "none" });
});
