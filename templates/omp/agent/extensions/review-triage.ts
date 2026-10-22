import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents");

export default function reviewTriage(pi: ExtensionAPI) {
	const params = pi.zod.object({ existingReport: pi.zod.boolean().describe("True to structure this session's existing thermonuclear findings; false to start a new read-only thermo review.") });
	pi.registerTool({
		name: "start_review_triage",
		label: "Start Review triage",
		loadMode: "essential",
		description: "Start a dashboard-bound Review triage session for this Terminal session. Use when read_review_triage is unavailable. existingReport keeps the original findings and numbering instead of rerunning a review. The dashboard owns identity, capture, and approval cards. This does not authorize edits, commits, pushes, GitHub writes, or applying findings.",
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return { content: [{ type: "text", text: "Expected { existingReport: boolean }." }], isError: true };
			if (ctx.agent.kind === "sub") return { content: [{ type: "text", text: "Start Review triage from the originating top-level session." }], isError: true };
			try {
				const holder: unknown = JSON.parse(readFileSync(join(CONFIG, "server.lock"), "utf8"));
				if (typeof holder !== "object" || holder === null || !("port" in holder) || typeof holder.port !== "number" || !Number.isSafeInteger(holder.port) || holder.port < 1 || holder.port > 65535) throw new Error("No owner dashboard is available. Start omp-agents and try again.");
				const base = `http://127.0.0.1:${holder.port}`;
				const token = readFileSync(join(CONFIG, "token"), "utf8").trim();
				const response = await fetch(`${base}/api/review-triage/${parsed.data.existingReport ? "session" : "start"}`, {
					method: "PUT", headers: { origin: base, cookie: `omp-agents-token=${token}`, "content-type": "application/json" },
					body: JSON.stringify({ sessionId: ctx.sessionManager.getSessionId() }), signal: AbortSignal.timeout(120_000),
				});
				const result: unknown = await response.json();
				if (!response.ok) throw new Error(typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : `Dashboard refused triage (${response.status}).`);
				return { content: [{ type: "text", text: `Started the dashboard-bound review session. Open ${base}/#session/${encodeURIComponent(ctx.sessionManager.getSessionId())}, then Review triage in the session details. Wait for the cards; do not apply or post anything in this Terminal session.` }] };
			} catch (error) {
				return { content: [{ type: "text", text: `Cannot start Review triage: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
			}
		},
	});
}
