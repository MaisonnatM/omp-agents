// omp-agents Bot designers: the `create_bot` tool, which asks the dashboard to create a new Bot, and the lines of the
// system prompt that say what it does. The dashboard loads it with `omp -e`, beside the Bot extension, for a Bot
// designer's session only (`Bots.join` in src/server/bots.ts), so no other session has the tool. It reads the Bot
// extension's own flags, the Bot's id and its `bot-inbox/`: omp keeps one value per flag name, and gives it to each
// extension that registers the name.
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { inbox } from "../../templates/omp/agent/extensions/inbox/client";
import { CREATE_TOOL } from "../shared/bot-designer";
import { BOT_KIND_INFO, BOT_KINDS, type BotCreateRequest, type BotId, MAX_JOB_LENGTH, parseBotId } from "../shared/bots";
import { BOT_FLAGS } from "./bot-extension";
import { type ExtensionApi, flagValue, reply } from "./extension-kit";

export interface CreateBotParams {
	name: string;
	job: string;
	kind?: string;
	cwd?: string;
}

const RULES = [
	"You are a Bot designer: you design the user's omp-agents Bots and create them.",
	`\`${CREATE_TOOL}\` asks the dashboard to create one new Bot with its name, its job, its type, and its workspace, yours when you leave it out. The user approves each call, and the call only leaves a request, which the dashboard applies.`,
	"The new Bot then shows in the Bots tab with its own conversation, where it learns its routines; you do not make its routines.",
	"You cannot edit or delete any Bot, not even one you created; the user does that on the Bot's page.",
].join("\n");

const isDirectory = (path: string): boolean => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

export default function designerExtension(pi: ExtensionApi): void {
	pi.registerFlag(BOT_FLAGS.bot, { type: "string", description: "The omp-agents Bot this session is." });
	pi.registerFlag(BOT_FLAGS.botInbox, { type: "string", description: "The directory create_bot leaves its requests in." });

	pi.on("before_agent_start", (event, ctx) => (ctx.agent.kind === "sub" || !flagValue(pi, BOT_FLAGS.bot) ? undefined : { systemPrompt: [...event.systemPrompt, RULES] }));

	const { Type } = pi.typebox;
	pi.registerTool<CreateBotParams>({
		name: CREATE_TOOL,
		label: "Create Bot",
		description: `Asks the dashboard to create a new omp-agents Bot, which the user then finds in the Bots tab. Its job is Markdown it follows alone, at most ${MAX_JOB_LENGTH} characters.`,
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "The new Bot's name, shown in the sidebar." }),
			job: Type.String({ maxLength: MAX_JOB_LENGTH, description: "The new Bot's whole job, as Markdown: what it does, where it looks, what it asks before acting, and what it never does." }),
			kind: Type.Optional(
				Type.Union(
					BOT_KINDS.map(kind => Type.Literal(kind)),
					{ description: "Its type: routines for most Bots, pr-shepherd for one that merges approved pull requests, bot-designer for another designer; routines when left out." },
				),
			),
			cwd: Type.Optional(Type.String({ minLength: 1, description: "The absolute path of the directory its conversation runs in; your own workspace when left out." })),
		}),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { name, job, kind = "routines", cwd }, _signal, _onUpdate, ctx) {
			const botId = parseBotId(flagValue(pi, BOT_FLAGS.bot));
			const dir = flagValue(pi, BOT_FLAGS.botInbox);
			if (!botId || !dir) throw new Error("This session is not an omp-agents Bot designer.");
			const title = name.trim();
			const text = job.trim();
			const type = BOT_KINDS.find(candidate => candidate === kind);
			const workspace = cwd ?? ctx.cwd;
			if (!title) throw new Error("name is empty.");
			if (text.length > MAX_JOB_LENGTH) throw new Error(`job is ${text.length} characters; keep it to at most ${MAX_JOB_LENGTH}.`);
			if (!type) throw new Error(`kind must be one of ${BOT_KINDS.join(", ")}.`);
			if (!isAbsolute(workspace) || !isDirectory(workspace)) throw new Error(`cwd ${workspace} is not the absolute path of a directory.`);
			inbox<BotCreateRequest>(dir).leave({ botId, create: { id: randomUUID() as BotId, kind: type, name: title, job: text, cwd: workspace } });
			return reply(`Asked the dashboard to create ${title}, a ${BOT_KIND_INFO[type].label} Bot in ${workspace}. It shows in the Bots tab once the dashboard applies it.`);
		},
	});
}
