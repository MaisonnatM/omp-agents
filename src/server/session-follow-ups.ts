/**
 * The `schedule_follow_up` tool a dashboard session gets, which schedules a message to the session itself, such as a
 * check on CI in five minutes, as the composer's **Send later** would: the scheduled runner delivers it, and the user
 * sees, edits, and cancels it in the sidebar's **Scheduled** group.
 */
import { randomUUID } from "node:crypto";
import type { RpcHostTool } from "../omp/module-types/rpc";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { MAX_SCHEDULED_TEXT, type ScheduledChange } from "../shared/scheduled";
import type { RosterHost, StartRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export const SCHEDULE_FOLLOW_UP_TOOL = "schedule_follow_up";
/** The latest a follow-up may wait, a week, in minutes. */
const MAX_MINUTES = 7 * 24 * 60;

export interface SessionFollowUpsDeps {
	/** The live sessions' roster rows, which give the caller's current session id. */
	hosts(): RosterHost[];
	/** Whether `request` starts a Bot's conversation, which gets no follow-up tool. */
	isBot(request: StartRequest): boolean;
	/** Saves `change` to the scheduled sends and tells every page; false when it changed nothing. */
	schedule(change: Extract<ScheduledChange, { op: "add" }>): boolean;
	now(): number;
}

export class SessionFollowUps {
	readonly #deps: SessionFollowUpsDeps;

	constructor(deps: SessionFollowUpsDeps) {
		this.#deps = deps;
	}

	/** How `request` joins the server as session `instanceId`: with its own follow-up tool, unless it starts a Bot's conversation. */
	join(request: StartRequest, instanceId: string): SessionJoin {
		return { rpc: this.#deps.isBot(request) ? PLAIN_LAUNCH : { ...PLAIN_LAUNCH, tools: [this.#toolFor(instanceId)] }, attach() {} };
	}

	/** The follow-up tool of session `caller`. */
	#toolFor(caller: string): RpcHostTool {
		return {
			name: SCHEDULE_FOLLOW_UP_TOOL,
			label: "Schedule follow-up",
			description: [
				"Schedule a message to this session itself, sent after a delay, so you can check back on something that takes time without polling, such as CI on a pull request you pushed or a deploy you started.",
				"The dashboard sends it as a follow-up while a turn runs, else as a new prompt, resuming the session first when it no longer runs; the user sees it in the sidebar's Scheduled group and can cancel it.",
				"Write `message` as the instruction your future self acts on, naming what to check and where, such as the pull request's URL.",
				`\`in_minutes\` is from 1 to ${MAX_MINUTES}, a week; the send goes on the dashboard's minute tick, so up to a minute late.`,
				"Schedule one only when the work waits on something outside this session; end your turn after scheduling it.",
			].join(" "),
			parameters: {
				type: "object",
				properties: {
					message: { type: "string", description: "The prompt this session receives when the time comes." },
					in_minutes: { type: "number", description: `How many minutes from now to send it, from 1 to ${MAX_MINUTES}.` },
				},
				required: ["message", "in_minutes"],
				additionalProperties: false,
			},
			loadMode: "essential",
			execute: async ({ message, in_minutes }) => {
				if (typeof message !== "string" || !message.trim()) throw new Error("message must be a non-empty text.");
				if (message.length > MAX_SCHEDULED_TEXT) throw new Error(`message must be at most ${MAX_SCHEDULED_TEXT} characters.`);
				if (typeof in_minutes !== "number" || !(in_minutes >= 1 && in_minutes <= MAX_MINUTES)) throw new Error(`in_minutes must be from 1 to ${MAX_MINUTES}.`);
				const host = this.#deps.hosts().find(row => row.instanceId === caller);
				if (!host) throw new Error("This session is not listed yet; try again in a moment.");
				const at = this.#deps.now() + Math.round(in_minutes * 60_000);
				const id = randomUUID();
				if (!this.#deps.schedule({ op: "add", send: { id, at, reset: null, target: { kind: "message", sessionId: host.sessionId, text: message } } })) {
					throw new Error("The dashboard did not save the follow-up.");
				}
				return `Scheduled for ${new Date(at).toISOString()} (id ${id}). End your turn now; the message arrives as your next prompt.`;
			},
		};
	}
}
