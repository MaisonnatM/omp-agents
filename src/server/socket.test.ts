import { describe, expect, test } from "bun:test";
import type { ClientMsg, ServerMsg } from "../shared/protocol";
import type { TrustAsk } from "../shared/project-trust";
import type { StartRequest, StartResult } from "../shared/sessions";
import { createClientHandler, type SocketEnv } from "./socket";
import { refusedText, untrustedText } from "./project-trust-file";
import type { Peer } from "./request-ledger";

const ask: TrustAsk = { root: "/repo", rootDisplay: "/repo", code: [{ kind: "tool", id: ".omp/tools/t.ts", name: ".omp/tools/t.ts", hash: "h", change: "new" }] };

/** The frames one message's handler sent, run over an env of `start` and nothing else it reaches. */
async function send(start: (request: StartRequest) => Promise<StartResult>, msg: ClientMsg): Promise<ServerMsg[]> {
	const frames: ServerMsg[] = [];
	const peer = { send: (frame: ServerMsg) => frames.push(frame) } as unknown as Peer;
	const env = { start, stoppedMidTurn: () => false } as unknown as SocketEnv;
	await createClientHandler(env)(peer, msg);
	return frames;
}

const resumeAll = (reqId: number, sessionIds: string[]): ClientMsg => ({ t: "resume-all", reqId, sessionIds });

describe("a start the page asked for", () => {
	test("reads its untrusted project refusal as a thing to trust here, not as advice to find a dashboard", async () => {
		const [frame] = await send(async () => ({ ok: false, error: untrustedText(ask), trust: ask }), { t: "start", reqId: 1, kind: "resume", sessionId: "s1" });
		expect(frame).toEqual({ t: "started", reqId: 1, result: { ok: false, error: refusedText(ask), trust: ask } });
		expect(refusedText(ask)).not.toBe(untrustedText(ask));
	});

	test("keeps any other failure as the server wrote it", async () => {
		const [frame] = await send(async () => ({ ok: false, error: "Cannot resume: no file" }), { t: "start", reqId: 2, kind: "resume", sessionId: "s1" });
		expect(frame).toEqual({ t: "started", reqId: 2, result: { ok: false, error: "Cannot resume: no file" } });
	});

	test("Resume all carries the first refusal for the dialog and reads every refusal as the page does", async () => {
		const [frame] = await send(
			async request => (request.kind === "resume" && request.sessionId === "s2" ? { ok: false, error: untrustedText(ask), trust: ask } : { ok: true, instanceId: "i1", workspace: "/repo", prompt: null }),
			resumeAll(3, ["s1", "s2"]),
		);
		expect(frame).toEqual({ t: "resumed-all", reqId: 3, started: [{ sessionId: "s1", instanceId: "i1" }], errors: [refusedText(ask)], trust: ask });
	});

	test("Resume all with no refusal asks nothing", async () => {
		const [frame] = await send(async () => ({ ok: false, error: "no file" }), resumeAll(4, ["s1"]));
		expect(frame).toEqual({ t: "resumed-all", reqId: 4, started: [], errors: ["no file"] });
	});
});
