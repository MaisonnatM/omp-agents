import { describe, expect, test } from "bun:test";
import { DICTATION_BUSY, type DictationEvent } from "../shared/dictation";
import type { ServerMsg } from "../shared/protocol";
import { Dictation, type StartCapture } from "./dictation";
import type { Peer } from "./request-ledger";
import type { Socket } from "./views";

function page(): { peer: Peer; sent: ServerMsg[] } {
	const sent: ServerMsg[] = [];
	const socket = {} as unknown as Socket;
	return { peer: { socket, send: msg => void sent.push(msg), reply: () => {} }, sent };
}

/** A microphone that records until stopped, ending with `heard`, or until disposed, ending with what it heard so far. */
function microphone(heard: string): { start: StartCapture; calls: string[] } {
	const calls: string[] = [];
	const start: StartCapture = (cwd, captureId, emit) => {
		calls.push(`start ${captureId} in ${cwd}`);
		emit({ kind: "state", state: "recording" });
		return {
			stop() {
				calls.push(`stop ${captureId}`);
				emit({ kind: "state", state: "transcribing" });
				emit({ kind: "end", text: heard, error: null });
			},
			dispose() {
				calls.push(`dispose ${captureId}`);
				emit({ kind: "end", text: "", error: null });
			},
		};
	};
	return { start, calls };
}

const events = (sent: ServerMsg[], captureId: string): DictationEvent[] =>
	sent.flatMap(msg => (msg.t === "dictation" && msg.captureId === captureId ? [msg.event] : []));

describe("Dictation", () => {
	test("sends each event of a capture to the page that started it, under its capture id", () => {
		const { start } = microphone("Explain the failing upload");
		const dictation = new Dictation(start);
		const { peer, sent } = page();
		dictation.start(peer, "c1", "~/code/app");
		dictation.stop(peer.socket, "c1");
		expect(events(sent, "c1")).toEqual([
			{ kind: "state", state: "recording" },
			{ kind: "state", state: "transcribing" },
			{ kind: "end", text: "Explain the failing upload", error: null },
		]);
	});

	test("a second capture ends at once while the microphone is held, and starts once it is free", () => {
		const { start, calls } = microphone("");
		const dictation = new Dictation(start);
		const first = page();
		const second = page();
		dictation.start(first.peer, "c1", "/app");
		dictation.start(second.peer, "c2", "/app");
		expect(events(second.sent, "c2")).toEqual([{ kind: "end", text: "", error: DICTATION_BUSY }]);
		dictation.stop(first.peer.socket, "c1");
		dictation.start(second.peer, "c3", "/app");
		expect(calls).toEqual(["start c1 in /app", "stop c1", "start c3 in /app"]);
	});

	test("stop and discard reach only the capture of the socket and id they name", () => {
		const { start, calls } = microphone("");
		const dictation = new Dictation(start);
		const owner = page();
		const other = page();
		dictation.start(owner.peer, "c1", "/app");
		dictation.stop(other.peer.socket, "c1");
		dictation.discard(owner.peer.socket, "c2");
		expect(calls).toEqual(["start c1 in /app"]);
		dictation.discard(owner.peer.socket, "c1");
		expect(calls).toEqual(["start c1 in /app", "dispose c1"]);
	});

	test("a closed socket closes the microphone it holds, and no other socket's", () => {
		const { start, calls } = microphone("");
		const dictation = new Dictation(start);
		const owner = page();
		const other = page();
		dictation.start(owner.peer, "c1", "/app");
		dictation.close(other.peer.socket);
		expect(calls).toEqual(["start c1 in /app"]);
		dictation.close(owner.peer.socket);
		expect(calls).toEqual(["start c1 in /app", "dispose c1"]);
	});

	test("a closed socket frees the microphone for the next capture even when its capture sends no end", () => {
		const calls: string[] = [];
		const silent: StartCapture = (_cwd, captureId) => ({ stop: () => {}, dispose: () => void calls.push(`dispose ${captureId}`) });
		const dictation = new Dictation(silent);
		const gone = page();
		const next = page();
		dictation.start(gone.peer, "c1", "/app");
		dictation.close(gone.peer.socket);
		dictation.start(next.peer, "c2", "/app");
		expect(calls).toEqual(["dispose c1"]);
		expect(events(next.sent, "c2")).toEqual([]);
	});
});
