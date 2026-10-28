// Records whether `omp -p` or `--mode json` runs a session, so the dashboard's past sessions leave out the one-shot
// runs other sessions start, as they leave out task subagents. Each start that changes the answer records it again,
// so a headless run resumed in a terminal lists, and an interactive session continued with `omp -p -c` stays listed.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const ENTRY = "omp-agents.headless";

export default function headlessMark(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const headless = ctx.mode === "print" || ctx.mode === "json";
		const last = ctx.sessionManager.getBranch().findLast((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === ENTRY);
		const recorded = (last as { data?: { headless?: unknown } } | undefined)?.data?.headless === true;
		if (recorded !== headless) pi.appendEntry(ENTRY, { headless });
	});
}
