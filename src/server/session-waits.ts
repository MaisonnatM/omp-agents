/**
 * The `wait_for_session` tool a dashboard session gets, which holds its call until another live session stops for the
 * user: its turn ends with no subagent it waits on still running, it asks a question, or it no longer runs.
 */
import { isObject } from "../json";
import type { RpcHostTool } from "../omp/module-types/rpc";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { awaitsSubagents, type RosterHost, type StartRequest, type UserRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const WAIT_FOR_SESSION_TOOL = "wait_for_session";
const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 240;
/** The most of the target's last reply an answer carries, in characters. */
const MAX_REPLY = 4000;
const SELF = "A session cannot wait on itself.";

export interface SessionWaitsDeps {
	/** The live sessions' roster rows. */
	hosts(): RosterHost[];
	/** The last reply in session `sessionId`'s file, of its running or last turn, `null` when it has none. */
	reply(sessionId: string): string | null;
	/** Whether `request` starts a Bot's conversation, which gets no wait tool. */
	isBot(request: StartRequest): boolean;
}

export class SessionWaits {
	readonly #deps: SessionWaitsDeps;
	/**
	 * The session that started each wait call, by tool call id, from the call's `tool_execution_start` until its end or the
	 * end of its turn or session: the tool cannot know its caller, and that event may come after the call itself.
	 */
	readonly #callers = new Map<string, string>();
	/** Each call that waits now, by tool call id. */
	readonly #waits = new Map<string, Wait>();
	readonly #tool: RpcHostTool = {
		name: WAIT_FOR_SESSION_TOOL,
		label: "Wait for session",
		description: [
			"Wait until another running session stops for the user: its turn ends with no subagent it waits on still running, it asks the user a question, or it no longer runs.",
			"Answers which of these stopped it, with its last reply.",
			"Use it when the user asks you to wait for a session, such as reviewing a branch once the session building it finishes.",
			'`session` is the id an `omp session "Title" (id …)` mention gives, or the session\'s exact title.',
			`\`timeout_minutes\` is at most ${MAX_MINUTES}; null waits ${DEFAULT_MINUTES}.`,
		].join(" "),
		parameters: {
			type: "object",
			properties: {
				session: { type: "string", description: "The session's id, from an omp session mention, or its exact title." },
				timeout_minutes: { type: ["number", "null"], description: `How long to wait at most, up to ${MAX_MINUTES} minutes; null waits ${DEFAULT_MINUTES}.` },
			},
			required: ["session", "timeout_minutes"],
			additionalProperties: false,
		},
		loadMode: "essential",
		execute: async ({ session, timeout_minutes }, { toolCallId, signal }) => {
			if (typeof session !== "string" || !session.trim()) throw new Error("session must be a session's id or its exact title.");
			const minutes = timeout_minutes ?? DEFAULT_MINUTES;
			if (typeof minutes !== "number" || !(minutes > 0 && minutes <= MAX_MINUTES)) throw new Error(`timeout_minutes must be above 0 and at most ${MAX_MINUTES}, or null for ${DEFAULT_MINUTES}.`);
			const target = this.#find(session.trim());
			if (target.instanceId === this.#callers.get(toolCallId)) throw new Error(SELF);
			const { promise, resolve, reject } = Promise.withResolvers<string>();
			const onAbort = () => wait.end(new Error("The wait was stopped."));
			const timer = setTimeout(() => wait.end(`Stopped waiting after ${minutes} minutes: ${wait.name} has not stopped for the user yet. Call wait_for_session again to keep waiting.`), minutes * 60_000);
			const wait: Wait = {
				target: target.instanceId,
				name: nameOf(target),
				sessionId: target.sessionId,
				end: outcome => {
					clearTimeout(timer);
					signal.removeEventListener("abort", onAbort);
					this.#waits.delete(toolCallId);
					if (outcome instanceof Error) reject(outcome);
					else resolve(outcome);
				},
			};
			if (signal.aborted) onAbort();
			else {
				signal.addEventListener("abort", onAbort, { once: true });
				this.#waits.set(toolCallId, wait);
				this.check();
			}
			return promise;
		},
	};

	constructor(deps: SessionWaitsDeps) {
		this.#deps = deps;
	}

	/** How `request` joins the server: with the wait tool, unless it starts a Bot's conversation. */
	join(request: StartRequest): SessionJoin {
		return { rpc: this.#deps.isBot(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#tool] }, attach() {} };
	}

	/** Session `instanceId` reported `event`: the start of a wait call names its caller, which refuses a wait on itself. */
	heard(instanceId: string, event: unknown): void {
		if (!isObject(event)) return;
		if (event.type === "agent_end") return this.#forget(instanceId);
		if (typeof event.toolCallId !== "string") return;
		if (event.type === "tool_execution_start" && event.toolName === WAIT_FOR_SESSION_TOOL) {
			this.#callers.set(event.toolCallId, instanceId);
			const wait = this.#waits.get(event.toolCallId);
			if (wait?.target === instanceId) wait.end(new Error(SELF));
		} else if (event.type === "tool_execution_end") this.#callers.delete(event.toolCallId);
	}

	/** Session `instanceId` exited, after the registry dropped it: its own waits end, and the waits on it answer. */
	exited(instanceId: string): void {
		for (const [toolCallId, wait] of this.#waits) if (this.#callers.get(toolCallId) === instanceId) wait.end(new Error("This session ended."));
		this.#forget(instanceId);
		this.check();
	}

	/** Answers each wait whose session stopped for the user; the server calls it whenever a live session's row may have changed. */
	check(): void {
		if (this.#waits.size === 0) return;
		const hosts = new Map(this.#deps.hosts().map(host => [host.instanceId, host]));
		for (const wait of this.#waits.values()) {
			const host = hosts.get(wait.target);
			if (!host) {
				wait.end(`${wait.name} no longer runs: it ended or its omp exited.${this.#reply(wait.sessionId)}`);
				continue;
			}
			// It may have been renamed or moved to a new session file since the wait started.
			wait.name = nameOf(host);
			wait.sessionId = host.sessionId;
			const asked = host.requests.map(questionOf).join(" ");
			if (asked || host.status === "needs-input") {
				wait.end(`${wait.name} waits on the user's answer, which the user gives in the dashboard; call wait_for_session again to wait until it stops again.${asked ? `\n\nIts question:\n\n${asked}` : ""}${this.#reply(host.sessionId)}`);
			} else if (host.status === "idle" && !awaitsSubagents(host)) {
				wait.end(`${wait.name} ended its turn and waits for the user.${this.#reply(host.sessionId)}`);
			}
		}
	}

	/** The live session `text` names, by session id or by exact title, or the error the model reads. */
	#find(text: string): RosterHost {
		const hosts = this.#deps.hosts();
		const byId = hosts.find(host => host.sessionId === text);
		if (byId) return byId;
		const titled = hosts.filter(host => host.sessionName?.toLowerCase() === text.toLowerCase());
		if (titled.length === 1) return titled[0]!;
		if (titled.length > 1) throw new Error(`${titled.length} running sessions are titled "${text}"; pass the session's id instead.`);
		throw new Error(`No running session has the id or title "${text}"; pass the id an omp session mention gives, of a session that runs now.`);
	}

	#reply(sessionId: string): string {
		const reply = this.#deps.reply(sessionId);
		if (!reply) return "";
		return `\n\nIts last reply:\n\n${reply.length > MAX_REPLY ? `${reply.slice(0, MAX_REPLY)}\n[cut at ${MAX_REPLY} characters]` : reply}`;
	}

	#forget(instanceId: string): void {
		for (const [toolCallId, caller] of this.#callers) if (caller === instanceId) this.#callers.delete(toolCallId);
	}
}

/**
 * A call that waits: the live session it waits on, by instance id, that session's name and session id as last seen, for
 * the answer once it no longer runs, and `end`, which answers the call with a text or fails it with an error.
 */
interface Wait {
	target: string;
	name: string;
	sessionId: string;
	end(outcome: string | Error): void;
}

function nameOf(host: RosterHost): string {
	return host.sessionName ? `"${host.sessionName}" (id ${host.sessionId})` : `Session ${host.sessionId}`;
}

/** What `request` asks the user, as one line of text. */
function questionOf(request: UserRequest): string {
	if (request.kind === "ask") return request.questions.map(question => question.question).join(" ");
	if (request.kind === "confirm") return `${request.title} ${request.message}`;
	return request.title;
}
