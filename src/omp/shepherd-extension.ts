// omp-agents PR shepherd Bots: the `fix_pull_request` and `queue_merge` tools, which ask the dashboard to start a quick
// action's session on a pull request or to queue its merge, and the lines of the system prompt that say what each does.
// The dashboard loads it with `omp -e`, beside the Bot extension, for a PR shepherd Bot's session only
// (`Bots.join` in src/server/bots.ts), so no other session has these tools.
import { parseBotId } from "../shared/bots";
import { parsePullRequest } from "../shared/github";
import { MAX_FIXES_PER_PULL_REQUEST, SHEPHERD_FIXES, type ShepherdChange } from "../shared/shepherd";
import { MERGE_METHODS } from "../shared/source-control";
import { type BotExtensionApi, leave, reply } from "./bot-extension";

/** The flags a shepherd's session starts with: its Bot's id, and the directory its tools leave their requests in. */
export const SHEPHERD_FLAGS = {
	bot: "omp-agents-shepherd",
	inbox: "omp-agents-shepherd-inbox",
} as const;

export const FIX_TOOL = "fix_pull_request";
export const MERGE_TOOL = "queue_merge";

interface PullRequestParams {
	owner: string;
	repo: string;
	number: number;
}

export type FixParams = PullRequestParams & { action: string };
export type MergeParams = PullRequestParams & { method?: string };

const RULES = [
	"You are a PR shepherd: you drive the user's approved pull requests to merged.",
	`\`${FIX_TOOL}\` starts one session on a pull request's branch that repairs it: ${SHEPHERD_FIXES.join(", ")}. Each session is its own conversation, so you do not do the fix yourself.`,
	`\`${MERGE_TOOL}\` hands a pull request to the dashboard's merge queue, which merges it once its checks pass.`,
	`The dashboard refuses a pull request the user did not write, one that is not approved, or one a session already works on; it starts each fix at most ${MAX_FIXES_PER_PULL_REQUEST} times per pull request, and queues a merge only when the head has the same diff as a commit a reviewer approved.`,
	"Both tools only leave a request; when the dashboard refuses one, it tells you why in this conversation. Then tell the user, and do not ask again for that pull request until a routine run names it again.",
].join("\n");

export default function shepherdExtension(pi: BotExtensionApi): void {
	pi.registerFlag(SHEPHERD_FLAGS.bot, { type: "string", description: "The omp-agents PR shepherd Bot this session is." });
	pi.registerFlag(SHEPHERD_FLAGS.inbox, { type: "string", description: "The directory its tools leave their requests in." });

	const flag = (name: string): string | null => {
		const value = pi.getFlag(name);
		return typeof value === "string" && value !== "" ? value : null;
	};

	/** Leaves `change` for the dashboard, from this session's shepherd. */
	const ask = (change: ShepherdChange): void => {
		const botId = parseBotId(flag(SHEPHERD_FLAGS.bot));
		const inbox = flag(SHEPHERD_FLAGS.inbox);
		if (!botId || !inbox) throw new Error("This session is not an omp-agents PR shepherd.");
		leave(inbox, { botId, change });
	};

	const pullRequest = ({ owner, repo, number }: PullRequestParams) => {
		const pr = parsePullRequest(owner, repo, number);
		if (!pr) throw new Error(`${owner}/${repo}#${number} is not a pull request name.`);
		return pr.ok;
	};

	pi.on("before_agent_start", (event, ctx) => (ctx.agent.kind === "sub" || !flag(SHEPHERD_FLAGS.bot) ? undefined : { systemPrompt: [...event.systemPrompt, RULES] }));

	const { Type } = pi.typebox;
	const target = {
		owner: Type.String({ minLength: 1, description: "The repository's owner, as in owner/repo." }),
		repo: Type.String({ minLength: 1, description: "The repository's name." }),
		number: Type.Integer({ minimum: 1, description: "The pull request's number." }),
	};

	pi.registerTool<FixParams>({
		name: FIX_TOOL,
		label: "Fix pull request",
		description: `Asks the dashboard to start a session on the pull request's branch that repairs one problem: fix-ci-and-conflicts rebases and fixes failing checks, fix-ci fixes failing checks, resolve-conflicts rebases, address-comments works through review threads.`,
		parameters: Type.Object({ ...target, action: Type.Union(SHEPHERD_FIXES.map(action => Type.Literal(action)), { description: "Which repair to start." }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { action, ...params }) {
			const pr = pullRequest(params);
			const fix = SHEPHERD_FIXES.find(candidate => candidate === action);
			if (!fix) throw new Error(`action must be one of ${SHEPHERD_FIXES.join(", ")}.`);
			ask({ op: "fix", pr, action: fix });
			return reply(`Asked the dashboard to start ${fix} on ${pr.owner}/${pr.repo}#${pr.number}.`);
		},
	});

	pi.registerTool<MergeParams>({
		name: MERGE_TOOL,
		label: "Queue merge",
		description: "Asks the dashboard to queue the pull request's merge, which it takes once GitHub allows it. Squash unless the user said otherwise.",
		parameters: Type.Object({ ...target, method: Type.Optional(Type.Union(MERGE_METHODS.map(method => Type.Literal(method)), { description: "How GitHub merges it; squash when left out." })) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { method = "squash", ...params }) {
			const pr = pullRequest(params);
			const chosen = MERGE_METHODS.find(candidate => candidate === method);
			if (!chosen) throw new Error(`method must be one of ${MERGE_METHODS.join(", ")}.`);
			ask({ op: "merge", pr, method: chosen });
			return reply(`Asked the dashboard to queue the ${chosen} merge of ${pr.owner}/${pr.repo}#${pr.number}.`);
		},
	});
}
