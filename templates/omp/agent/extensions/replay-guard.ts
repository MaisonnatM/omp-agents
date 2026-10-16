import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { ReplayMarker } from "../../../../src/shared/replay";
import { checkReplayRequest, containsPrompt } from "./replay/replay-check";
import { replayMarkerOf } from "./replay/replay-metadata";
import { judgeReplayTool } from "./replay/replay-policy";
import type { GuardPolicy, Inspector } from "./replay/replay-policy";

export const REPLAY_MARKER = "omp-agents-replay";

export default function replayGuard(pi: ExtensionAPI) {
	pi.registerFlag("replay-safe-edits", { type: "boolean", description: "Dashboard replay launch has disabled implicit LSP writes." });
	pi.registerFlag("replay-package", { type: "string", description: "Installed omp package used to inspect local replay edits." });
	pi.registerFlag("replay-nonce", { type: "string", description: "Acknowledges this replay RPC launch before any prompt is sent." });
	let editInspect: Inspector | undefined;
	const inspector = (): Inspector | undefined => {
		if (editInspect) return editInspect;
		const installed = pi.getFlag("replay-package");
		if (typeof installed !== "string") return undefined;
		const require = createRequire(join(installed, "package.json"));
		const native: unknown = require("@oh-my-pi/pi-natives");
		if (!native || typeof native !== "object" || !("editInspect" in native) || typeof native.editInspect !== "function") return undefined;
		editInspect = native.editInspect as Inspector;
		return editInspect;
	};
	let marker: ReplayMarker | null = null;
	let policy: GuardPolicy | null = process.env.OMP_REPLAY_ROOT ? { worktree: process.env.OMP_REPLAY_ROOT, originalRoots: [] } : null;
	let checked = false;
	const arm = (entries: readonly { type: string; customType?: string; data?: unknown }[]) => {
		const at = entries.findLastIndex(entry => entry.type === "custom" && entry.customType === REPLAY_MARKER);
		const parsed = replayMarkerOf(entries[at]?.data);
		if (parsed) {
			marker = parsed;
			policy = { worktree: marker.roots.replay, originalRoots: marker.roots.original };
			process.env.OMP_REPLAY_ROOT = policy.worktree;
			checked = entries.slice(at + 1).some(entry => entry.type === "custom" && entry.customType === "omp-agents-replay-check");
		}
	};
	pi.on("session_start", (_event, ctx) => arm(ctx.sessionManager.getBranch()));
	pi.on("session_switch", (_event, ctx) => {
		arm(ctx.sessionManager.getBranch());
		if (marker && pi.getFlag("replay-safe-edits") && inspector()) pi.appendEntry("omp-agents-replay-ready", { v: 1, id: marker.id, nonce: pi.getFlag("replay-nonce") });
	});
	pi.on("tool_call", (event, ctx) => {
		if (!policy) arm(ctx.sessionManager.getBranch());
		if (!policy) return;
		if ((event.toolName === "edit" || event.toolName === "write") && !pi.getFlag("replay-safe-edits")) return { block: true, reason: "Replay guard: local writes require the dashboard's safe replay launch." };
		let reason: string | null;
		try { reason = judgeReplayTool(event.toolName, event.input as Record<string, unknown>, ctx.cwd, policy, inspector()); }
		catch { reason = "The replay guard could not establish a safe target. The tool was blocked."; }
		if (!reason) return;
		pi.appendEntry("omp-agents-replay-block", { toolCallId: event.toolCallId, reason });
		return { block: true, reason: `Replay guard: ${reason}` };
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (!marker) arm(ctx.sessionManager.getBranch());
		if (!marker || checked) return;
		if (ctx.model?.id !== marker.model.id || ctx.model?.provider !== marker.model.provider) return;
		const branch = ctx.sessionManager.getBranch();
		const markerAt = branch.findLastIndex(entry => entry.type === "custom" && entry.customType === REPLAY_MARKER);
		const prompt = branch.slice(markerAt + 1).find(entry => entry.type === "message" && entry.message.role === "user" || entry.type === "custom_message" && entry.customType === "skill-prompt" && entry.attribution === "user");
		if (!prompt) return;
		const content = prompt.type === "message" ? prompt.message.content : prompt.content;
		if (!containsPrompt(event.payload, content)) return;
		checked = true;
		let original: unknown = null;
		try {
			if (marker.original) original = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "", ".omp", "agent"), "blobs", marker.original.bodyRef.replace(/^blob:sha256:/, "")), "utf8"));
		} catch { /* Missing blobs leave the check unknown. */ }
		pi.appendEntry("omp-agents-replay-check", checkReplayRequest(marker, original, event.payload, ctx.model?.api ?? null, ctx.model?.id ?? null));
	});
}
