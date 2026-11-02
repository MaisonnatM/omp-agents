/**
 * What a Router's routines see before the Router does: the rules in code drop the team messages that need nothing, and
 * an event on a pull request or Slack thread that an open task follows goes straight into that task's session, so the
 * Router's turn reads only what is left, all of one check's events in one message, with how many messages it dropped.
 */
import { errorText } from "../json";
import type { Routine, RoutineRun, TriggerEvent } from "../routines";
import type { BotId } from "../shared/bots";
import type { RouterTask } from "../shared/router";
import { droppedLine, followOf, followsText, needsNothing, passThroughText } from "../shared/router-rules";
import type { RoutineScreen } from "./routine-runner";
import type { RouterTaskEdit, RouterTasksFile } from "./router-tasks";

export interface RouterEventsDeps {
	/** Whether Bot `botId` is a Router. */
	isRouter(botId: BotId): boolean;
	file: Pick<RouterTasksFile, "following">;
	/** Applies `edit` to the tasks, for the pages to hear. */
	apply(edit: RouterTaskEdit): unknown;
	/** Sends `text` into session `sessionId` as a follow-up, resuming the session when it is not live; rejects when it cannot. */
	messageSession(sessionId: string, text: string): Promise<void>;
}

/** The screen of a Router Bot's routines; any other Bot's events go through untouched. */
export class RouterEvents implements RoutineScreen {
	readonly #deps: RouterEventsDeps;
	/** How many team messages each Router's rules dropped since its last events reached it. */
	readonly #dropped = new Map<BotId, number>();

	constructor(deps: RouterEventsDeps) {
		this.#deps = deps;
	}

	/**
	 * The events of `events` that should reach `routine`'s Router: without the ones its rules drop, which it counts, and
	 * without the ones that went to the session of an open task of its own that follows where they happened. An event a
	 * task's session could not take reaches the Router instead.
	 */
	async events(routine: Routine, events: TriggerEvent[]): Promise<TriggerEvent[]> {
		const { botId } = routine;
		if (!this.#deps.isRouter(botId)) return events;
		const kept = events.filter(event => !needsNothing(event));
		if (kept.length < events.length) this.#dropped.set(botId, (this.#dropped.get(botId) ?? 0) + events.length - kept.length);
		const toRouter = new Set<TriggerEvent>();
		const byTask = new Map<string, { task: RouterTask & { sessionId: string }; events: TriggerEvent[] }>();
		for (const event of kept) {
			const follow = followOf(event);
			const tasks = follow ? this.#deps.file.following(follow).filter((task): task is RouterTask & { sessionId: string } => task.botId === botId && task.sessionId !== null) : [];
			if (tasks.length === 0) toRouter.add(event);
			for (const task of tasks) {
				const entry = byTask.get(task.id) ?? { task, events: [] };
				entry.events.push(event);
				byTask.set(task.id, entry);
			}
		}
		await Promise.all(
			[...byTask.values()].map(async ({ task, events: heard }) => {
				try {
					await this.#deps.messageSession(task.sessionId, passThroughText(heard));
					this.#deps.apply({ op: "heard", id: task.id });
				} catch (error) {
					console.error(`omp-agents: cannot pass ${heard.length} event(s) to task ${task.id}, so they go to its Router: ${errorText(error)}`);
					for (const event of heard) toRouter.add(event);
				}
			}),
		);
		return kept.filter(event => toRouter.has(event));
	}

	/** A triggered run of a Router's routine also names each event's follow and, once, how many team messages its rules dropped since. */
	prompt(routine: Routine, run: RoutineRun, prompt: string): string {
		const { botId } = routine;
		if (run.triggeredBy.length === 0 || !this.#deps.isRouter(botId)) return prompt;
		const dropped = droppedLine(this.#dropped.get(botId) ?? 0);
		this.#dropped.delete(botId);
		return [prompt, followsText(run.triggeredBy), dropped].filter(part => part !== null).join("\n\n");
	}
}
