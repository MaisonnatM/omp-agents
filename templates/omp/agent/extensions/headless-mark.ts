// Marks a session that `omp -p` or `--mode json` runs, so the dashboard's past sessions leave out the one-shot runs
// other sessions start, as they leave out task subagents.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function headlessMark(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "print" || ctx.mode === "json") pi.appendEntry("omp-agents.headless");
	});
}
