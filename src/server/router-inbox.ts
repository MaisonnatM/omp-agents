/**
 * The requests a Router Bot's `start_task`, `follow`, and `finish_task` tools (`src/omp/router-extension.ts`) leave for
 * the server, one JSON file each. A start saves the task, then starts its session in the task's directory, named after
 * the task; a request the server refuses is done too, and the Router hears why in its conversation.
 */
import { errorText } from "../json";
import type { Bot, BotId } from "../shared/bots";
import { parseRouterRequest, type RouterRequest, type TaskFollow } from "../shared/router";
import { newSessionRequest, type StartRequest, type StartResult, type WorkItem } from "../shared/sessions";
import { type InboxOptions, JsonInboxDir } from "./json-inbox";
import type { RouterTasks, RouterTasksFile } from "./router-tasks";

export interface RouterInboxDeps {
	bots(): readonly Bot[];
	file: RouterTasksFile;
	tasks: RouterTasks;
	start(request: StartRequest): Promise<StartResult>;
	/** The session started here as `instanceId`, which a task's title names. */
	started(instanceId: string): { sessionId: string; rename(title: string): Promise<void> } | undefined;
	/** Tells Bot `botId` something in its conversation. */
	tell(botId: BotId, text: string): Promise<unknown>;
	now(): number;
}

/** The work item a task's session is about: the first pull request or Linear issue it follows, which its session row shows. */
function subjectOf(follows: readonly TaskFollow[]): WorkItem | null {
	for (const follow of follows) {
		if (follow.kind === "pull-request") return { kind: "pull-request", pr: { owner: follow.owner, repo: follow.repo, number: follow.number } };
		if (follow.kind === "linear") return { kind: "ticket", id: follow.id };
	}
	return null;
}

export class RouterInbox extends JsonInboxDir<RouterRequest> {
	constructor(dir: string, deps: RouterInboxDeps, options?: InboxOptions) {
		const { file, tasks } = deps;
		super(
			dir,
			{
				parse(_name, value) {
					const request = parseRouterRequest(value);
					if (!request) return { invalid: "it is not a Router's request" };
					const bot = deps.bots().find(({ id }) => id === request.ok.botId);
					if (!bot) return { invalid: `there is no Bot ${request.ok.botId}` };
					return bot.kind === "router" ? { item: request.ok } : { invalid: `Bot ${bot.id} is not a Router` };
				},
				apply: async ({ botId, change }) => {
					const refuse = (what: string, why: string) => deps.tell(botId, `The dashboard did not ${what}: ${why}.`).then(() => true);
					if (change.op === "start") {
						const { task } = change;
						// The tool minted the id, so a request read again, as after a crash, finds its task and starts nothing.
						if (file.get(task.id)) return true;
						const now = deps.now();
						tasks.apply({ op: "add", task: { ...task, botId, sessionId: null, status: "working", startedAt: now, updatedAt: now, restarts: 0, note: null } });
						const result = await deps.start(newSessionRequest(task.cwd, task.prompt, { subject: subjectOf(task.follows) })).catch((error: unknown): StartResult => ({ ok: false, error: errorText(error) }));
						const session = result.ok ? deps.started(result.instanceId) : undefined;
						if (!result.ok || !session) {
							const why = result.ok ? "its session exited as it started" : result.error;
							tasks.apply({ op: "status", id: task.id, status: "stopped", note: why });
							return await refuse(`start task "${task.title}"`, why);
						}
						tasks.bind(result.instanceId, task.id, session.sessionId);
						await session.rename(task.title).catch((error: unknown) => console.error(`omp-agents: cannot name task ${task.id}'s session: ${errorText(error)}`));
						return true;
					}
					const task = file.get(change.taskId);
					const what = change.op === "follow" ? `route more to task ${change.taskId}` : `mark task ${change.taskId} ${change.status}`;
					if (!task || task.botId !== botId) return await refuse(what, "you have no such task");
					if (change.op === "follow") tasks.apply({ op: "follow", id: task.id, follows: change.follows });
					else tasks.finish(task.id, change.status, change.note);
					return true;
				},
			},
			options,
		);
	}
}
