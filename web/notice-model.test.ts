import { expect, test } from "bun:test";
import type { Notice, StoppedSession } from "../src/shared/notices";
import { hashForSession } from "../src/shared/sessions";
import { presentNotice, TOAST_MS } from "./notice-model";
import { hashForSettings } from "./routing";

const NOW = 1791000000000;
const flags = { at: NOW, seen: false, read: false };

test("a Slack message opens in Slack and toasts briefly", () => {
	const shown = presentNotice({ id: "s", ...flags, kind: "slack", from: "Ann", avatarUrl: null, text: "hi", permalink: "https://slack/x", type: "dm", count: 2 }, NOW);
	expect(shown).toMatchObject({ source: "slack", headline: "Ann sent you 2 messages", preview: "hi", link: { href: "https://slack/x", external: true }, action: { kind: "none" }, toast: { kind: "news", timeout: TOAST_MS } });
});

test("a provider out of credit names its footer row, so the API key reads as API credits", () => {
	const shown = presentNotice({ id: "c", ...flags, kind: "credits", provider: "anthropic-api", model: "claude-opus-5-5", failures: 2, since: NOW, error: "Your credit balance is too low" }, NOW);
	expect(shown.headline).toBe("Out of credit: API credits");
	expect(shown.preview).toStartWith("2 requests to claude-opus-5-5 failed since");
});

test("an event stays toasted and opens the Calendar page when kept on this computer, or the session that added it", () => {
	const event = { id: "e", ...flags, kind: "event", title: "Standup", start: NOW + 60_000, end: NOW + 600_000, calendar: null, color: null, url: null, sessionId: null } as const;
	const shown = presentNotice(event, NOW);
	expect(shown.source).toBe("calendar");
	expect(shown.headline).toStartWith("Standup starts at");
	expect(shown.link).toEqual({ href: "#calendar", external: false });
	expect(shown.toast).toEqual({ kind: "news", timeout: 0 });
	expect(presentNotice({ ...event, sessionId: "s1" }, NOW).link).toEqual({ href: hashForSession("s1"), external: false });
});

test("a signed-out Google account asks to sign in again in Settings › Integrations and stays toasted", () => {
	const signIn = { id: "g", ...flags, kind: "sign-in", service: "google-calendar", account: "google-calendar", address: "me@example.com" } as const;
	expect(presentNotice(signIn, NOW)).toMatchObject({
		source: "integrations",
		headline: "Google Calendar is signed out",
		preview: "me@example.com: sign in again in Settings › Integrations. Sessions cannot use it until then.",
		link: { href: hashForSettings("integrations"), external: false },
		face: { kind: "sign-in", service: "google-calendar" },
		action: { kind: "none" },
		toast: { kind: "news", timeout: 0 },
	});
	expect(presentNotice({ ...signIn, service: "gmail", account: "gmail-2", address: null }, NOW)).toMatchObject({
		headline: "Gmail is signed out",
		preview: "Account gmail-2: sign in again in Settings › Integrations. Sessions cannot use it until then.",
	});
});

test("an update's action, failure, and toast follow its status", () => {
	const update = (status: Extract<Notice, { kind: "omp" }>["status"], seen = false): Notice => ({ id: "u", ...flags, seen, kind: "omp", current: "1", latest: "2", status });
	expect(presentNotice(update({ state: "available" }, true), NOW)).toMatchObject({ source: "updates", headline: "omp 2 is out", link: null, action: { kind: "update", updating: false, ready: true }, toast: { kind: "update", dismissedElsewhere: true } });
	expect(presentNotice(update({ state: "updating" }), NOW)).toMatchObject({ busy: true, action: { updating: true, ready: false } });
	expect(presentNotice(update({ state: "failed", error: "boom" }), NOW)).toMatchObject({ failed: true, preview: "boom", action: { ready: true } });
	expect(presentNotice(update({ state: "updated", note: "done" }), NOW).action).toEqual({ kind: "none" });
});

test("new omp-agents commits name their count and branch, and their Update pulls and restarts", () => {
	const dashboard = (commits: number): Notice => ({ id: "d", ...flags, kind: "dashboard", branch: "main", running: "a1b2c3d4e5", commits, status: { state: "available" } });
	expect(presentNotice(dashboard(1), NOW)).toMatchObject({ source: "updates", headline: "omp-agents update: 1 new commit on main", preview: "Update pulls them and restarts omp-agents.", action: { kind: "update", updating: false, ready: true } });
	expect(presentNotice(dashboard(4), NOW).headline).toBe("omp-agents update: 4 new commits on main");
});

test("an omp-agents update that did not start says where omp-agents went back to and why, toasts until dismissed, and offers no Update", () => {
	const failed: Notice = { id: "f", ...flags, kind: "dashboard-failed", branch: "main", running: "a1b2c3d4e5", failed: { commit: "e5f6a7b8c9", failure: "exited with code 1" } };
	expect(presentNotice(failed, NOW)).toMatchObject({
		source: "updates",
		headline: "omp-agents update undone",
		preview: "omp-agents went back to a1b2c3d until origin/main has a newer commit. e5f6a7b did not start (exited with code 1).",
		failed: true,
		action: { kind: "none" },
		toast: { kind: "news", timeout: 0 },
	});
});

test("sessions that stopped mid-turn are counted, named as past sessions are, stay toasted, open the first of them, and Continue all carries their ids", () => {
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
		link: { href: "#session/s1", external: false },
		action: { kind: "continue-all", sessionIds: ["s1", "s2", "s3"] },
		toast: { kind: "news", timeout: 0 },
	});
});
