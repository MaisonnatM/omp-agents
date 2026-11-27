import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Routine, RoutineOutcome } from "../../../src/routines";
import { type DashboardActions, DashboardActionsContext } from "../dashboard-context";
import { RoutineDetail } from "./routine-row";

const NOW = Date.parse("2026-10-05T09:00:00Z");

/** The open routine whose latest run stands at `outcome`, with the server holding queued runs for `held`; the routine runs on Run now alone, so it shows no countdown. */
function rowHtml(outcome: RoutineOutcome, held: string | null = null): string {
	const routine: Routine = {
		id: "r1",
		workspace: "/w",
		name: "Notes",
		schedules: [],
		triggers: [],
		task: { kind: "command", command: "git fetch" },
		enabled: true,
		machine: null,
		createdAt: NOW - 60_000,
		scheduledAt: NOW - 1_000,
		runs: [{ at: NOW - 1_000, outcome, errors: [], triggeredBy: [] }],
	};
	return renderToStaticMarkup(
		<DashboardActionsContext.Provider value={{ request: async () => {}, send: () => {} } as unknown as DashboardActions}>
			<RoutineDetail routine={routine} template={null} held={held} connected now={NOW} />
		</DashboardActionsContext.Provider>,
	);
}

/** The Run now button of the open routine whose latest run stands at `outcome`. */
function runNowButton(outcome: RoutineOutcome): string {
	const html = rowHtml(outcome);
	const button = html.match(/<button[^>]*aria-label="Run Notes now"[^>]*>/)?.[0];
	if (!button) throw new Error("The routine has no Run now button.");
	return button;
}

test("Run now takes no second click while the server holds the last run queued, sending, or running", () => {
	for (const outcome of [{ kind: "queued" }, { kind: "sending" }, { kind: "command", run: { phase: "running", startedAt: NOW - 1_000 } }] as const) {
		expect(runNowButton(outcome)).toMatch(/ disabled=""/);
	}
	expect(runNowButton({ kind: "command", run: { phase: "exited", code: 0, output: "", startedAt: NOW - 1_000, endedAt: NOW - 500 } })).not.toMatch(/ disabled=""/);
});

test("a queued run the server holds says why it waits instead of running, and says nothing once it runs", () => {
	const reason = "Memory is under pressure, so unattended work waits until it eases.";
	const held = rowHtml({ kind: "queued" }, reason);
	expect(held).toContain(`Waiting for memory: ${reason}`);
	expect(held).not.toContain("Running…");
	expect(rowHtml({ kind: "queued" })).toContain("Running…");
	expect(rowHtml({ kind: "sending" }, reason)).not.toContain("Waiting for memory");
});