/** The one microphone capture under way, by the socket and capture that started it, so that page can stop or discard it and its closed socket ends it. */
import type { DictationEvent } from "../shared/dictation";
import type { Peer } from "./request-ledger";
import type { Socket } from "./views";

/** One capture under way: `stop` keeps what was said, `dispose` closes the microphone at once. */
export interface Capture {
	stop(): void;
	dispose(): void;
}

/** Opens the microphone, as `startDictation` in src/omp/dictation.ts does: events through `emit`, the last an `end`. */
export type StartCapture = (cwd: string, captureId: string, emit: (event: DictationEvent) => void) => Capture;

/** Why a capture did not start: this computer has one microphone, and another composer holds it. */
export const BUSY = "Dictation is active in another composer";

interface Slot {
	socket: Socket;
	captureId: string;
	capture: Capture | null;
}

export class Dictation {
	readonly #start: StartCapture;
	#slot: Slot | null = null;

	constructor(start: StartCapture) {
		this.#start = start;
	}

	/** Opens the microphone for `captureId` with the settings of `cwd`, its events going to the page as `dictation` messages; a held microphone ends it at once. */
	start(peer: Peer, captureId: string, cwd: string): void {
		const send = (event: DictationEvent): void => peer.send({ t: "dictation", captureId, event });
		if (this.#slot) return send({ kind: "end", text: "", error: BUSY });
		const slot: Slot = { socket: peer.socket, captureId, capture: null };
		this.#slot = slot;
		slot.capture = this.#start(cwd, captureId, event => {
			if (event.kind === "end" && this.#slot === slot) this.#slot = null;
			send(event);
		});
	}

	/** Stops `ws`'s capture `captureId`, which ends with what was said. */
	stop(ws: Socket, captureId: string): void {
		this.#owned(ws, captureId)?.capture?.stop();
	}

	/** Closes the microphone of `ws`'s capture `captureId` at once; the page drops whatever text it ends with. */
	discard(ws: Socket, captureId: string): void {
		this.#owned(ws, captureId)?.capture?.dispose();
	}

	/** `ws` closed: no page reads its capture any more, so the microphone closes. */
	close(ws: Socket): void {
		if (this.#slot?.socket === ws) this.#slot.capture?.dispose();
	}

	#owned(ws: Socket, captureId: string): Slot | null {
		const slot = this.#slot;
		return slot && slot.socket === ws && slot.captureId === captureId ? slot : null;
	}
}
