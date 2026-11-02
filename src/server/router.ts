/**
 * Router Bots on the server, wired once: the tasks they hand to background sessions, the inbox their tools leave
 * requests in, the screen their routines' events pass first, and the supervisor that restarts a stuck task. The
 * Dashboard builds one and forwards the lifecycle of every live session to it.
 */
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import type { Bot, BotId } from "../shared/bots";
import type { StartRequest, StartResult } from "../shared/sessions";
import { repeat } from "./loops";
import type { LiveSessions } from "./live-sessions";
import { RouterEvents } from "./router-events";
import { RouterInbox } from "./router-inbox";
import { readTaskTail, RouterSupervisor, SUPERVISOR_TICK_MS } from "./router-supervisor";
import { RouterTasks } from "./router-tasks";
import type { SessionJoin } from "./start";

export interface RouterDeps {
	/** `router-tasks.json`. */
	tasksFile: string;
	/** The directory Router tools leave their requests in. */
	inboxDir: string;
	bots(): readonly Bot[];
	sessions: Pick<LiveSessions, "bySessionId" | "started">;
	/** Session `sessionId`'s saved file, `null` when it is not found. */
	pathOf(sessionId: string): string | null;
	start(request: StartRequest): Promise<StartResult>;
	/** Session `sessionId` live, resumed when it does not run; rejects when it does not resume. */
	reach(sessionId: string): Promise<LiveSession>;
	/** Ends `session` as End session does. */
	end(session: LiveSession): Promise<void>;
	/** Tells Bot `botId` something in its conversation. */
	tell(botId: BotId, text: string): Promise<unknown>;
	/** Whether this server runs the Routers' work: the one that holds the owner lock. */
	active(): boolean;
	now(): number;
	/** The tasks changed, for the pages to hear. */
	onChange(): void;
}

export class Router {
	readonly tasks: RouterTasks;
	/** What a Router's routines see before the Router does; the routine runner's screen. */
	readonly screen: RouterEvents;
	readonly #inbox: RouterInbox;
	readonly #supervisor: RouterSupervisor;
	readonly #onChange: () => void;
	#stopSupervisor = (): void => {};

	constructor(deps: RouterDeps) {
		this.#onChange = deps.onChange;
		const { sessions, active, tell, now } = deps;
		const tasks = (this.tasks = new RouterTasks({
			path: deps.tasksFile,
			active,
			tell,
			end: async sessionId => {
				const session = sessions.bySessionId(sessionId);
				if (session) await deps.end(session);
			},
			now,
			onChange: deps.onChange,
		}));
		this.screen = new RouterEvents({
			isRouter: botId => deps.bots().some(bot => bot.id === botId && bot.kind === "router"),
			tasks,
			messageSession: async (sessionId, text) => (await deps.reach(sessionId)).prompt(null, text, [], "followUp"),
		});
		this.#inbox = new RouterInbox(deps.inboxDir, { bots: deps.bots, tasks, start: deps.start, started: instanceId => sessions.started(instanceId), tell, now }, { active });
		this.#supervisor = new RouterSupervisor({
			tasks,
			active,
			live: sessionId => {
				const session = sessions.bySessionId(sessionId);
				if (!session) return null;
				const { status, agents } = session.row();
				const activity = agents.flatMap(agent => (agent.status === "running" ? [`${agent.id} ${agent.activity ?? ""}`] : [])).join("\n");
				return { busy: status === "working", activity, interrupt: () => session.interrupt() };
			},
			tail: sessionId => {
				const path = sessions.bySessionId(sessionId)?.transcriptPath(null, deps.pathOf) ?? deps.pathOf(sessionId);
				return path === null ? null : readTaskTail(path);
			},
			reach: deps.reach,
			tell,
		});
	}

	/** Reads the inbox as requests arrive, and supervises the working tasks every {@link SUPERVISOR_TICK_MS}. */
	watch(): void {
		this.#inbox.watch();
		this.#stopSupervisor = repeat("Router supervisor", () => this.#supervisor.check(), SUPERVISOR_TICK_MS);
	}

	stop(): void {
		this.#stopSupervisor();
		this.#inbox.stop();
	}

	/** This server took over the Routers' work: what the last owner saved, which the pages hear, then the requests it left. */
	takeOver(): void {
		this.tasks.reload();
		this.#onChange();
		void this.#inbox.drain();
	}

	join(request: StartRequest): SessionJoin {
		return this.tasks.join(request);
	}

	/**
	 * Live session `instanceId` exited, `ended` when End session ended it; call it once the registry no longer holds it,
	 * so a restart resumes the session rather than reaching the one that exited. Returns whether the supervisor restarts
	 * the task whose session went down on its own mid-turn, which makes that session the supervisor's to continue.
	 */
	exited(instanceId: string, ended: boolean): boolean {
		const died = this.tasks.exited(instanceId, ended);
		if (!died) return false;
		this.#supervisor.died(died).catch((error: unknown) => console.error(`omp-agents: cannot restart task ${died.id}, whose session died: ${errorText(error)}`));
		return true;
	}

	switched(instanceId: string, sessionId: string): void {
		this.tasks.switched(instanceId, sessionId);
	}

	turnStarted(instanceId: string): void {
		this.tasks.turnStarted(instanceId);
	}

	/** A task's session that ends its turn waits for review, and tells its Router. */
	turnEnded(instanceId: string, reply: string | null): void {
		void this.tasks.turnEnded(instanceId, reply);
	}
}
