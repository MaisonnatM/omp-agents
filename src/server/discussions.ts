/** The **Ask about this** answers under way, by the socket that asked, so the page can stop one and a closed socket stops its own. */
import type { DiscussionEvent, DiscussionRequest } from "../shared/discussions";
import type { Peer } from "./request-ledger";
import type { Socket } from "./views";

/** Answers one question, as `answerDiscussion` in src/omp/discussion.ts does: events through `emit`, the last an `end`. */
export type Answer = (request: DiscussionRequest, signal: AbortSignal, emit: (event: DiscussionEvent) => void) => Promise<void>;

export class Discussions {
	readonly #answer: Answer;
	readonly #running = new Map<Socket, Map<number, AbortController>>();

	constructor(answer: Answer) {
		this.#answer = answer;
	}

	/** Answers `request` to the page as `discussion` events for `id`; asking again with the same `id` stops the earlier answer. */
	async ask(peer: Peer, id: number, request: DiscussionRequest): Promise<void> {
		const running = this.#running.get(peer.socket) ?? new Map<number, AbortController>();
		this.#running.set(peer.socket, running);
		running.get(id)?.abort();
		const controller = new AbortController();
		running.set(id, controller);
		try {
			await this.#answer(request, controller.signal, event => peer.send({ t: "discussion", id, event }));
		} finally {
			if (running.get(id) === controller) running.delete(id);
			if (running.size === 0 && this.#running.get(peer.socket) === running) this.#running.delete(peer.socket);
		}
	}

	/** Stops the answer to `ws`'s `id`, which then ends with no error. */
	stop(ws: Socket, id: number): void {
		this.#running.get(ws)?.get(id)?.abort();
	}

	/** `ws` closed: no page reads its answers any more, so each stops. */
	close(ws: Socket): void {
		for (const controller of this.#running.get(ws)?.values() ?? []) controller.abort();
		this.#running.delete(ws);
	}
}
