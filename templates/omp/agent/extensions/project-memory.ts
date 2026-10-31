import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { applyMemoryOps, indexText, MEMORY_KINDS, MEMORY_LIMIT, memoryTip, parseOps, readMemory, type Slug } from "./project-memory/memory";
import { intentOf, isFirstPrompt, lastSeen, newsFor, NOTE_TYPE } from "./project-memory/news";
import { placeOf, recordIntent } from "./project-memory/repo";

const text = (value: string, isError?: boolean) => ({ content: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) });

export default function projectMemory(pi: ExtensionAPI) {
	const z = pi.zod;
	const params = z.object({
		read: z.string().optional().describe("A memory's slug: returns its line, source, and body."),
		ops: z
			.array(
				z.object({
					op: z.enum(["add", "update", "delete"]),
					slug: z.string().describe("Lowercase letters, digits, and hyphens, at most 48, such as `release-needs-tag`."),
					kind: z.enum(MEMORY_KINDS).optional().describe("Required for add."),
					line: z.string().optional().describe("Required for add: one self-contained line of at most 120 characters, readable without the body."),
					body: z.string().optional().describe("Required for add: the detail, at most 2000 characters."),
				}),
			)
			.optional()
			.describe("One batch of changes, applied all or nothing in order."),
	});

	pi.registerTool({
		loadMode: "essential",
		name: "project_memory",
		label: "Project memory",
		description: [
			"Reads and changes the memory this git repository's omp sessions share: decisions, facts, and lessons, one per slug.",
			"With no arguments it lists the index; `read` returns one memory's body; `ops` applies one batch of add, update, and delete.",
			"Write a memory when the user states a decision, when you learn a fact the code does not show, or when a mistake teaches a lesson.",
			"Update an existing memory rather than add a near-duplicate, and keep each `line` self-contained.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return text("Invalid project_memory input.", true);
			const { read, ops } = parsed.data;
			if (read !== undefined && ops !== undefined) return text("Pass either read or ops, not both.", true);
			const place = placeOf(ctx.cwd);
			if (!place) return text(`Project memory needs a git repository, and ${ctx.cwd} is not in one.`, true);
			const { commonDir } = place.root;
			try {
				if (ops === undefined) {
					const doc = readMemory(commonDir, memoryTip(commonDir));
					if (read === undefined) return text(indexText(doc) || "This repository has no memories yet.");
					const memory = doc.memories[read as Slug];
					if (!memory) return text(`No memory has the slug ${read}; project_memory with no arguments lists them.`, true);
					return text(`${read} [${memory.kind}] — ${memory.line} (updated ${memory.updated}, source ${memory.source})\n\n${memory.body}`);
				}
				if (ctx.agent.kind === "sub") return text("A subagent may read project memory but not change it; tell your parent session what to remember.", true);
				const domain = parseOps(ops);
				const plan = domain.ok ? applyMemoryOps(commonDir, ctx.sessionManager.getSessionId(), domain.ops, new Date().toISOString().slice(0, 10)) : domain;
				if (!plan.ok) return text(`Refused, nothing written: ${plan.reasons.join(" ")}`, true);
				return text(`${plan.summary}. ${Object.keys(plan.doc.memories).length} of ${MEMORY_LIMIT} memories.`);
			} catch (error) {
				return text(`Project memory failed: ${error instanceof Error ? error.message : String(error)}`, true);
			}
		},
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (event.reason === "revive" || ctx.agent.kind === "sub" || ctx.mode === "print" || ctx.mode === "json") return;
		const place = placeOf(ctx.cwd);
		if (!place) return;
		const entries = ctx.sessionManager.getBranch();
		const session = ctx.sessionManager.getSessionId();
		const now = new Date();
		const intent = isFirstPrompt(entries) ? intentOf(event.prompt) : null;
		if (intent) recordIntent(place.root, session, intent, now.toISOString());
		const news = newsFor(place, session, lastSeen(entries), now);
		if (!news) return;
		return { message: { customType: NOTE_TYPE, content: news.text, display: false, details: { seen: news.seen } } };
	});
}
