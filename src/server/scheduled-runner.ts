/**
 * Sends the scheduled messages and starts the scheduled sessions once their time comes.
 * A send is claimed on disk before it goes, so a second tick or the next server never sends it twice; one that a stopped
 * server left sending fails rather than going again, since it may have reached its session.
 */
import { errorText } from "../json";
import { isDueSend, type ScheduledTarget } from "../shared/scheduled";
import type { StartRequest, StartResult } from "../shared/sessions";
import type { ScheduledFile } from "./scheduled-file";

/** A live session as the runner reaches it. */
interface Recipient {
	/** A follow-up while its turn runs, else a prompt; rejects when it does not reach omp. */
	followUp(text: string): Promise<void>;
}

export interface ScheduledRunnerDeps {
	file: ScheduledFile;
	start(request: StartRequest): Promise<StartResult>;
	/** The live session with session id `sessionId`, or `null` when none runs. */
	bySessionId(sessionId: string): Recipient | null;
	/** Live session `instanceId`, or `null` once it is gone. */
	session(instanceId: string): Recipient | null;
	now(): number;
	/** The scheduled sends changed; every socket should hear them. */
	onChange(): void;
}

export const STOPPED_WHILE_SENDING = "The dashboard stopped while it sent this. Check the session before you send it again.";

export class ScheduledRunner {
	readonly #deps: ScheduledRunnerDeps;

	constructor(deps: ScheduledRunnerDeps) {
		this.#deps = deps;
	}

	/** Fails the sends a stopped server left sending. Called by the server that sends them, when it starts or takes over. */
	recover(): void {
		const { file, now } = this.#deps;
		file.reload();
		const stranded = file.sends.filter(send => send.state.phase === "sending");
		for (const send of stranded) file.failed(send.id, STOPPED_WHILE_SENDING, now());
		if (stranded.length > 0) this.#deps.onChange();
	}

	/** Sends every send whose time came, soonest first. */
	async tick(): Promise<void> {
		const { file, now } = this.#deps;
		file.reload();
		const at = now();
		for (const send of file.sends.filter(candidate => isDueSend(candidate, at))) await this.sendNow(send.id);
	}

	/** Sends `id` now, whatever its time, or tries a failed one again; a send already under way sends once. */
	async sendNow(id: string): Promise<void> {
		const { file, now, onChange } = this.#deps;
		const send = file.claim(id);
		if (!send) return;
		onChange();
		try {
			await this.#deliver(send.target);
			file.sent(id);
		} catch (error) {
			file.failed(id, errorText(error), now());
		}
		onChange();
	}

	async #deliver(target: ScheduledTarget): Promise<void> {
		const { start, bySessionId, session } = this.#deps;
		if (target.kind === "start") {
			const result = await start(target.request);
			if (!result.ok) throw new Error(result.error);
			return;
		}
		let recipient = bySessionId(target.sessionId);
		if (!recipient) {
			const result = await start({ kind: "resume", sessionId: target.sessionId });
			if (!result.ok) throw new Error(`Cannot resume the session: ${result.error}`);
			recipient = session(result.instanceId);
			if (!recipient) throw new Error("The session exited as it resumed.");
		}
		await recipient.followUp(target.text);
	}
}
