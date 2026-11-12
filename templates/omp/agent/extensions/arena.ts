// The `arena` tool: an agent that sets two or more subagents on the same task to keep the best attempt records which
// subagents compete, the judge, the one it picked as the base, and what it took from the others. Each call appends an
// `omp-arena.state` entry to the session file, which the omp-agents dashboard reads to show the runners side by side in
// the Session card's Subagents section and mark the winner. A call naming the same runners as an earlier one updates it.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const ENTRY = "omp-arena.state";

export default function arena(pi: ExtensionAPI) {
	// The session that runs the arena records it, so a subagent's requests leave out this tool's schema.
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind === "sub") await pi.setActiveTools(pi.getActiveTools().filter(name => name !== "arena"));
	});
	const z = pi.zod;
	const params = z.object({
		task: z.string().trim().min(1).describe("What every runner was asked to produce, in a few words."),
		runners: z.array(z.string().trim().min(1)).min(2).max(26).describe("The competing subagents' ids, as the task tool returned them, in the order you spawned them."),
		judge: z.string().trim().min(1).optional().describe("The judge subagent's id, once you spawn one."),
		base: z.string().trim().min(1).optional().describe("The runner you picked as the base, once you pick."),
		grafts: z
			.array(z.object({ from: z.string().trim().min(1).describe("A runner other than the base."), what: z.string().trim().min(1).describe("What you took from it, in a few words.") }))
			.optional()
			.describe("What you took from the other runners into the base."),
	});

	pi.registerTool({
		loadMode: "essential",
		name: "arena",
		label: "Arena",
		description: [
			"Record an arena: two or more subagents given the same task so you can keep the best attempt.",
			"Call it right after you spawn the runners, again with judge once you spawn a judge, and again with base and grafts once you pick.",
			"Each call carries the whole record; a call naming the same runners updates that arena.",
			"The omp-agents dashboard shows the runners side by side and marks the base.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return { content: [{ type: "text", text: "Invalid arena input." }], isError: true };
			if (ctx.agent.kind === "sub") return { content: [{ type: "text", text: "The session that runs the arena records it." }], isError: true };
			const { task, runners, judge, base, grafts = [] } = parsed.data;
			if (new Set(runners).size !== runners.length) return { content: [{ type: "text", text: "Each runner is named once." }], isError: true };
			if (judge !== undefined && runners.includes(judge)) return { content: [{ type: "text", text: `The judge ${judge} is one of the runners.` }], isError: true };
			if (base !== undefined && !runners.includes(base)) return { content: [{ type: "text", text: `The base ${base} is not one of the runners.` }], isError: true };
			const stray = grafts.find(graft => !runners.includes(graft.from) || graft.from === base);
			if (stray) return { content: [{ type: "text", text: `A graft comes from a runner other than the base, not ${stray.from}.` }], isError: true };
			pi.appendEntry(ENTRY, { task, runners, judge: judge ?? null, base: base ?? null, grafts });
			return { content: [{ type: "text", text: base ? `Recorded ${base} as the base of the arena.` : `Recorded the arena of ${runners.length} runners.` }] };
		},
	});
}
