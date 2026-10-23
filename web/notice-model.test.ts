import { expect, test } from "bun:test";
import type { Notice, StoppedSession } from "../src/shared/notices";
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

test("new omp-agents commits name their count and branch, and their Update pulls and restarts", () => {
	const dashboard = (commits: number): Notice => ({ id: "d", ...flags, kind: "dashboard", branch: "main", commits, status: { state: "available" } });
	expect(presentNotice(dashboard(1), NOW)).toMatchObject({ source: "updates", headline: "omp-agents update: 1 new commit on main", preview: "Update pulls them and restarts omp-agents.", action: { kind: "update", label: "Update", ready: true } });
	expect(presentNotice(dashboard(4), NOW).headline).toBe("omp-agents update: 4 new commits on main");
});

test("sessions that stopped mid-turn are counted, named as past sessions are, stay toasted, and Continue all carries their ids", () => {
	const stopped = (sessions: StoppedSession[]): Notice => ({ id: "x", ...flags, kind: "stopped", sessions });
	expect(presentNotice(stopped([{ sessionId: "s1", title: "Fix the login", cwdDisplay: "~/code/webapp" }]), NOW)).toMatchObject({ source: "sessions", headline: "1 session stopped mid-turn", preview: "Fix the login" });
	expect(
		presentNotice(
			stopped([
				{ sessionId: "s1", title: "Fix the login", cwdDisplay: "~/code/webapp" },
				{ sessionId: "s2", title: null, cwdDisplay: "~/code/api" },
				{ sessionId: "s3", title: null, cwdDisplay: null },
			]),
			NOW,
		),
	).toMatchObject({
		headline: "3 sessions stopped mid-turn",
		preview: "Fix the login · api · Untitled session",
		link: null,
		action: { kind: "continue-all", sessionIds: ["s1", "s2", "s3"] },
		toast: { kind: "news", timeout: 0 },
	});
});
