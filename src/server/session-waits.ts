/**
 * The `wait_for_session` tool a dashboard session gets, which holds its call until another live session stops for the
 * user: its turn ends with no subagent it waits on still running, it asks a question, or it no longer runs.
 */
import type { RpcHostTool } from "../omp/module-types/rpc";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { type RosterHost, type StartRequest, type Stop, stopOf, type UserRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const WAIT_FOR_SESSION_TOOL = "wait_for_session";
const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 240;
/** The most of the target's last reply an answer carries, in characters. */
const MAX_REPLY = 4000;

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
	/** Each call that waits now, by tool call id. */
	readonly #waits = new Map<string, Wait>();

	constructor(deps: SessionWaitsDeps) {
		this.#deps = deps;
	}

	/** How `request` joins the server as session `instanceId`: with its own wait tool, unless it starts a Bot's conversation. */
	join(request: StartRequest, instanceId: string): SessionJoin {
		return { rpc: this.#deps.isBot(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#toolFor(instanceId)] }, attach() {} };
	}

	/** Session `instanceId` exited: its own waits end. */
	exited(instanceId: string): void {
		for (const wait of this.#waits.values()) if (wait.caller === instanceId) wait.end(new Error("This session ended."));
	}

	/** Answers each wait whose session stopped for the user; the server calls it whenever the roster may have changed. */
	check(): void {
		if (this.#waits.size === 0) return;
		const hosts = new Map(this.#deps.hosts().map(host => [host.instanceId, host]));
		for (const wait of this.#waits.values()) {
			const host = hosts.get(wait.last.instanceId);
			if (!host) {
				wait.end(`${nameOf(wait.last)} no longer runs: it ended or its omp exited.${this.#reply(wait.last.sessionId)}`);
				continue;
			}
			// It may have been renamed or moved to a new session file since the wait started.
			wait.last = host;
			const stop = stopOf(host);
			if (stop) wait.end(`${stoppedText(nameOf(host), stop)}${this.#reply(host.sessionId)}`);
		}
	}

	/** The wait tool of session `caller`. */
	#toolFor(caller: string): RpcHostTool {
		return {
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
				if (target.instanceId === caller) throw new Error("A session cannot wait on itself.");
				const { promise, resolve, reject } = Promise.withResolvers<string>();
				const onAbort = () => wait.end(new Error("The wait was stopped."));
				const timer = setTimeout(() => wait.end(`Stopped waiting after ${minutes} minutes: ${nameOf(wait.last)} has not stopped for the user yet. Call wait_for_session again to keep waiting.`), minutes * 60_000);
				const wait: Wait = {
					caller,
					last: target,
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
}

/**
 * A call that waits: the session that called it, by instance id, the row of the live session it waits on as last seen,
 * for the answer once it no longer runs, and `end`, which answers the call with a text or fails it with an error.
 */
interface Wait {
	caller: string;
	last: RosterHost;
	end(outcome: string | Error): void;
}

function nameOf(host: RosterHost): string {
	return host.sessionName ? `"${host.sessionName}" (id ${host.sessionId})` : `Session ${host.sessionId}`;
}

/** What the answer says of session `name`, which stopped for the user for `stop`. */
function stoppedText(name: string, stop: Stop): string {
	switch (stop.kind) {
		case "ask":
			return `${name} waits on the user's answer, which the user gives in the dashboard; call wait_for_session again to wait until it stops again.\n\nIts question:\n\n${questionOf(stop.request)}`;
		case "input":
			return `${name} waits on the user's answer, which the user gives in the dashboard; call wait_for_session again to wait until it stops again.`;
		case "turn-ended":
			return `${name} ended its turn and waits for the user.`;
		default: {
			const unhandled: never = stop;
			return unhandled;
		}
	}
}

/** What `request` asks the user, as one line of text. */
function questionOf(request: UserRequest): string {
	if (request.kind === "ask") return request.questions.map(question => question.question).join(" ");
	if (request.kind === "confirm") return `${request.title} ${request.message}`;
	return request.title;
}
