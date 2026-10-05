import { describe, expect, test } from "bun:test";
import type { PastSession, RosterHost } from "../src/shared";
import { documentTitle } from "./document-title";

const host = (sessionName: string | null, cwdDisplay = "~/code/webapp") => ({ sessionName, cwdDisplay }) as RosterHost;
const past = (title: string | null) => ({ title, cwdDisplay: "~/code/webapp" }) as PastSession;

describe("documentTitle", () => {
	test("a page names itself ahead of the app", () => {
		expect(documentTitle({ kind: "settings", cwd: null }, null, null, null)).toBe("Settings · omp agents");
		expect(documentTitle({ kind: "new", cwd: "~/code" }, null, null, null)).toBe("New session · omp agents");
	});

	test("a ticket's page names the ticket, and the list names the tickets", () => {
		expect(documentTitle({ kind: "tickets", target: "ENG-2368" }, null, null, null)).toBe("ENG-2368 · omp agents");
		expect(documentTitle({ kind: "tickets", target: null }, null, null, null)).toBe("Tickets · omp agents");
	});

	test("a page covers the conversation behind it", () => {
		const view = { kind: "live", instanceId: "a", agentId: null } as const;
		expect(documentTitle({ kind: "inbox", target: null }, view, host("Fix login"), null)).toBe("Inbox · omp agents");
	});

	test("a live session reads as its name, else its project", () => {
		const view = { kind: "live", instanceId: "a", agentId: null } as const;
		expect(documentTitle(null, view, host("Fix login"), null)).toBe("Fix login · omp agents");
		expect(documentTitle(null, view, host(null), null)).toBe("webapp · omp agents");
	});

	test("a subagent reads ahead of its session", () => {
		const view = { kind: "live", instanceId: "a", agentId: "0-Explore" } as const;
		expect(documentTitle(null, view, host("Fix login"), null)).toBe("0-Explore · Fix login · omp agents");
		expect(documentTitle(null, view, null, null)).toBe("0-Explore · omp agents");
	});

	test("a past session reads as its title", () => {
		const view = { kind: "past", sessionId: "s" } as const;
		expect(documentTitle(null, view, null, past("Fix login"))).toBe("Fix login · omp agents");
		expect(documentTitle(null, view, null, past(null))).toBe("webapp · omp agents");
	});

	test("nothing open, or a view the roster no longer lists, leaves the app name alone", () => {
		expect(documentTitle(null, null, null, null)).toBe("omp agents");
		expect(documentTitle(null, { kind: "past", sessionId: "s" }, null, null)).toBe("omp agents");
		expect(documentTitle(null, { kind: "live", instanceId: "a", agentId: null }, null, null)).toBe("omp agents");
	});
});
