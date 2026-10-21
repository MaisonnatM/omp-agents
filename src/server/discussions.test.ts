import { describe, expect, test } from "bun:test";
import type { DiscussionRequest } from "../shared/discussions";
import type { ServerMsg } from "../shared/protocol";
import { type Answer, Discussions } from "./discussions";
import type { Peer } from "./request-ledger";
import type { Socket } from "./views";

const request: DiscussionRequest = { source: "session “Fix login”", quote: "ttl: 0", turns: [], question: "Why zero?" };

/** An answer that names its model, then waits until stopped, ending with no error as `answerDiscussion` does. */
const untilStopped: Answer = async (_request, signal, emit) => {
	emit({ kind: "model", model: "anthropic/claude-haiku-4-5" });
	await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
	emit({ kind: "end", error: null });
};

function page(): { peer: Peer; sent: ServerMsg[] } {
	const sent: ServerMsg[] = [];
	const socket = {} as unknown as Socket;
	return { peer: { socket, send: msg => void sent.push(msg), reply: () => {} }, sent };
}

describe("Discussions", () => {
	test("sends each event of an answer to the page that asked, under its id", async () => {
		const discussions = new Discussions(async (_request, _signal, emit) => {
			emit({ kind: "text", text: "Nothing is cached." });
			emit({ kind: "end", error: null });
		});
		const { peer, sent } = page();
		await discussions.ask(peer, 3, request);
		expect(sent).toEqual([
			{ t: "discussion", id: 3, event: { kind: "text", text: "Nothing is cached." } },
			{ t: "discussion", id: 3, event: { kind: "end", error: null } },
		]);
	});

	test("stop ends only the answer it names", async () => {
		const discussions = new Discussions(untilStopped);
		const { peer, sent } = page();
		const first = discussions.ask(peer, 0, request);
		void discussions.ask(peer, 1, request);
		discussions.stop(peer.socket, 0);
		await first;
		expect(sent.filter(msg => msg.t === "discussion" && msg.event.kind === "end")).toEqual([{ t: "discussion", id: 0, event: { kind: "end", error: null } }]);
		discussions.close(peer.socket);
	});

	test("a closed socket stops every answer it asked for, and no other socket's", async () => {
		const discussions = new Discussions(untilStopped);
		const closing = page();
		const staying = page();
		const answers = [discussions.ask(closing.peer, 0, request), discussions.ask(closing.peer, 1, request)];
		void discussions.ask(staying.peer, 0, request);
		discussions.close(closing.peer.socket);
		await Promise.all(answers);
		expect(closing.sent.filter(msg => msg.t === "discussion" && msg.event.kind === "end").length).toBe(2);
		expect(staying.sent).toEqual([{ t: "discussion", id: 0, event: { kind: "model", model: "anthropic/claude-haiku-4-5" } }]);
		discussions.close(staying.peer.socket);
	});
});
