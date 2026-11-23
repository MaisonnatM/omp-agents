import { describe, expect, test } from "bun:test";
import { applyBoardChange, type BoardChange, type BoardState, emptyBoard, type Message, sessionMemberId } from "../shared/board";
import type { RosterHost } from "../shared/sessions";
import { BoardWake } from "./board-wake";

/** Every microtask queued so far, including a started session's follow-up posts, has run. */
function settled(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setImmediate(resolve);
	return promise;
}
const host = (sessionId: string, cwd: string): RosterHost => ({ sessionId, sessionName: "worker", cwd, cwdDisplay: cwd, model: null, requests: [], status: "idle" }) as unknown as RosterHost;

function board(hosts: RosterHost[] = [], start: (cwd: string, projectId: string | null) => Promise<string> = async () => "new-1") {
	let state: BoardState = {
		...emptyBoard("Maxence"),
		channels: [
			{ id: "c-general", name: "general", about: "" },
			{ id: "c-proj", name: "proj", about: "", project: { goal: "", decisions: [], sessionIds: ["s-old"], createdAt: 0 } },
		],
		threads: [
			{ id: "t-a", channel: "c-general", title: "Fix login", task: null, lease: null, createdAt: 0 },
			{ id: "t-p", channel: "c-proj", title: "Step one", task: null, lease: null, createdAt: 0 },
		],
	};
	const started: { cwd: string; projectId: string | null; prompt: string }[] = [];
	const woken: string[] = [];
	const apply = (change: BoardChange) => {
		const applied = applyBoardChange(state, change);
		if ("error" in applied) throw new Error(applied.error);
		state = applied.ok;
		wake.check();
	};
	const wake: BoardWake = new BoardWake({
		state: () => state,
		hosts: () => hosts,
		bots: () => [],
		apply,
		wake: async session => void woken.push(session),
		wakeBot: async () => {},
		startSession: async (cwd, prompt, projectId) => {
			started.push({ cwd, projectId, prompt });
			return start(cwd, projectId);
		},
		workspaces: () => ["/code/app", "/code/other"],
		active: () => true,
		now: () => 1,
	});
	const post = (id: string, thread: string, text: string, cwd?: string) => apply({ op: "post", message: { id, thread, author: state.me, at: 1, text, ...(cwd ? { cwd } : {}) } satisfies Message });
	return { post, started, woken, state: () => state };
}

describe("a person's message in a thread with no agent", () => {
	test("starts a session in the first workspace that joins the thread, and a reply wakes it instead of starting another", async () => {
		const { post, started, woken, state } = board();
		post("m1", "t-a", "Please fix the login page");
		expect(started).toEqual([{ cwd: "/code/app", projectId: null, prompt: expect.stringContaining("Please fix the login page") }]);
		post("m2", "t-a", "Also the logout one");
		await settled();
		expect(started).toHaveLength(1);
		expect(state().messages.some(msg => msg.thread === "t-a" && msg.author === sessionMemberId("new-1"))).toBe(true);
		post("m3", "t-a", "Any news?");
		expect(started).toHaveLength(1);
		expect(woken).toEqual(["new-1"]);
	});

	test("in a project channel, runs where the project's live session runs and joins the project", () => {
		const { post, started } = board([host("s-old", "/code/proj")]);
		post("m1", "t-p", "Start on step one");
		expect(started.map(({ cwd, projectId }) => ({ cwd, projectId }))).toEqual([{ cwd: "/code/proj", projectId: "c-proj" }]);
	});

	test("outside a project, runs in the workspace the message picked", () => {
		const { post, started } = board();
		post("m1", "t-a", "Go", "/code/other");
		expect(started.map(item => item.cwd)).toEqual(["/code/other"]);
	});

	test("a message that mentions a live session wakes it and starts nothing", () => {
		const { post, started, woken } = board([host("s-old", "/code/proj")]);
		post("m1", "t-a", "@worker can you look?");
		expect(started).toEqual([]);
		expect(woken).toEqual(["s-old"]);
	});

	test("a failed start lets the next message try again", async () => {
		let fail = true;
		const { post, started } = board([], async () => {
			if (fail) throw new Error("no omp");
			return "new-2";
		});
		post("m1", "t-a", "First try");
		await settled();
		fail = false;
		post("m2", "t-a", "Second try");
		expect(started).toHaveLength(2);
	});
});
