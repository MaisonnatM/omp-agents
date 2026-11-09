import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Routine, RoutineOutcome } from "../../../src/routines";
import type { BotId } from "../../../src/shared/bots";
import { type DashboardActions, DashboardActionsContext } from "../dashboard-context";
import { RoutineRow } from "./routine-row";

const NOW = Date.parse("2026-10-05T09:00:00Z");

/** The Run now button of a row whose latest run stands at `outcome`; the routine runs on Run now alone, so the row shows no countdown. */
function runNowButton(outcome: RoutineOutcome): string {
	const routine: Routine = {
		id: "r1",
		botId: "scout" as BotId,
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
	const html = renderToStaticMarkup(
		<DashboardActionsContext.Provider value={{ request: async () => {}, send: () => {} } as unknown as DashboardActions}>
			<RoutineRow routine={routine} botName="Scout" open={false} connected now={NOW} />
		</DashboardActionsContext.Provider>,
	);
	const button = html.match(/<button[^>]*aria-label="Run Notes now"[^>]*>/)?.[0];
	if (!button) throw new Error("The row has no Run now button.");
	return button;
}

test("Run now takes no second click while the server holds the last run queued, sending, or running", () => {
	for (const outcome of [{ kind: "queued" }, { kind: "sending" }, { kind: "command", run: { phase: "running", startedAt: NOW - 1_000 } }] as const) {
		expect(runNowButton(outcome)).toMatch(/ disabled=""/);
	}
	expect(runNowButton({ kind: "command", run: { phase: "exited", code: 0, output: "", startedAt: NOW - 1_000, endedAt: NOW - 500 } })).not.toMatch(/ disabled=""/);
});
