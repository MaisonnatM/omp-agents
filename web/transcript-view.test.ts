import { describe, expect, test } from "bun:test";
import type { Item } from "../src/shared/transcript";
import { editablePrompt, forkPoints, nextSuggestions, outline, toBlocks, turnReplies } from "./transcript-view";

describe("transcript rendering", () => {
	const user: Item = { id: "u", kind: "user", text: "go", skill: null, from: null, entryId: "e-u" };
	const tool = (id: string, status: "running" | "ok"): Item => ({ id, kind: "tool", name: "bash", summary: "ls", status, agents: [] });

	const thinking = (id: string): Item => ({ id, kind: "thinking", text: "hmm", streaming: false });

	test("consecutive tools and thinking group into one block; a message splits groups", () => {
		const blocks = toBlocks([thinking("h1"), tool("t1", "ok"), tool("t2", "ok"), user, tool("t3", "running")]);
		expect(blocks.map(block => (block.kind === "activity" ? block.entries.map(entry => entry.id).join("+") : block.item.id))).toEqual([
			"h1+t1+t2",
			"u",
			"t3",
		]);
	});
});

describe("forkPoints", () => {
	const prompt = (id: string, entryId: string | null): Item => ({ id, kind: "user", text: id, skill: null, from: null, entryId });
	const reply = (id: string, streaming = false): Item => ({ id, kind: "assistant", text: id, streaming, suggestions: [] });
	const tool: Item = { id: "t", kind: "tool", name: "bash", summary: "ls", status: "ok", agents: [] };

	test("a prompt forks at itself; a turn's last reply forks at the next prompt, keeping the whole turn", () => {
		const items = [prompt("p1", "e1"), reply("r1a"), tool, reply("r1b"), prompt("p2", "e2"), reply("r2")];
		expect(Object.fromEntries(forkPoints(items))).toEqual({
			p1: { entryId: "e1", prefill: true },
			r1b: { entryId: "e2", prefill: false },
			p2: { entryId: "e2", prefill: true },
		});
	});

	test("a reply forks only when a prompt omp can branch at follows it, and not while it streams", () => {
		const items = [
			prompt("p1", "e1"),
			reply("r1"),
			prompt("collab", null),
			reply("r2"),
			prompt("p3", "e3"),
			reply("r3", true),
			prompt("steer", "e4"),
			reply("r4"),
		];
		expect(Object.fromEntries(forkPoints(items))).toEqual({
			p1: { entryId: "e1", prefill: true },
			r2: { entryId: "e3", prefill: false },
			p3: { entryId: "e3", prefill: true },
			steer: { entryId: "e4", prefill: true },
		});
	});
});

describe("editablePrompt", () => {
	const prompt = (id: string, entryId: string | null, extra: Partial<Extract<Item, { kind: "user" }>> = {}): Item => ({
		id,
		kind: "user",
		text: id,
		skill: null,
		from: null,
		entryId,
		...extra,
	});
	const reply: Item = { id: "r", kind: "assistant", text: "r", streaming: false, suggestions: [] };

	test("only the last prompt is editable, through the replies after it", () => {
		expect(editablePrompt([prompt("p1", "e1"), reply, prompt("p2", "e2"), reply])).toEqual({ itemId: "p2", entryId: "e2" });
	});

	test("a last prompt omp has not saved yet leaves none editable, not the one before it", () => {
		expect(editablePrompt([prompt("p1", "e1"), reply, prompt("p2", null)])).toBeNull();
	});

	test("a skill prompt or one with images is not editable, since the edit resends text alone", () => {
		expect(editablePrompt([prompt("p1", "e1", { skill: "review" })])).toBeNull();
		expect(editablePrompt([prompt("p1", "e1", { images: ["data:image/png;base64,AA=="] })])).toBeNull();
	});
});

describe("turnReplies", () => {
	const prompt = (id: string): Item => ({ id, kind: "user", text: id, skill: null, from: null, entryId: id });
	const reply = (id: string, text = id): Item => ({ id, kind: "assistant", text, streaming: false, suggestions: [] });
	const tool: Item = { id: "t", kind: "tool", name: "bash", summary: "ls", status: "ok", agents: [] };
	const items = [prompt("p1"), reply("r1a"), tool, reply("r1b"), reply("r1c", " "), prompt("p2"), reply("r2a"), tool, reply("r2b")];

	test("each turn's last reply with text, skipping the replies between its tool calls", () => {
		expect([...turnReplies(items, false)]).toEqual(["r2b", "r1b"]);
	});

	test("a turn still running has no reply yet", () => {
		expect([...turnReplies(items, true)]).toEqual(["r1b"]);
	});
});

describe("outline", () => {
	const prompt = (id: string, text: string, extra: Partial<Extract<Item, { kind: "user" }>> = {}): Item => ({ id, kind: "user", text, skill: null, from: null, entryId: id, ...extra });
	const reply = (id: string, text: string): Item => ({ id, kind: "assistant", text, streaming: false, suggestions: [] });
	const tool = (status: "ok" | "error"): Item => ({ id: `t-${status}`, kind: "tool", name: "bash", summary: "ls", status, agents: [] });
	const thinking: Item = { id: "th", kind: "thinking", text: "hmm", streaming: false };
	const items = [prompt("p1", "Fix it"), reply("r1a", "Looking"), thinking, tool("ok"), tool("error"), reply("r1b", " Fixed. "), prompt("p2", "Ship it"), reply("r2", "Shipping")];

	test("groups each prompt with its turn's final reply and counts the turn's tools and failures", () => {
		expect(outline(items, false)).toEqual([
			{ id: "p1", prompt: "Fix it", skill: null, nudge: null, reply: { id: "r1b", text: "Fixed." }, tools: 2, failed: 1, running: false },
			{ id: "p2", prompt: "Ship it", skill: null, nudge: null, reply: { id: "r2", text: "Shipping" }, tools: 0, failed: 0, running: false },
		]);
	});

	test("the turn still running has no reply until it ends, and only it runs", () => {
		const turns = outline(items, true);
		expect(turns.map(turn => [turn.id, turn.reply?.id ?? null, turn.running])).toEqual([
			["p1", "r1b", false],
			["p2", null, true],
		]);
	});

	test("a prompt without text reads as the images it carried, and a skill prompt keeps its skill", () => {
		expect(
			outline(
				[
					prompt("one", "", { images: ["data:image/png;base64,AA=="] }),
					prompt("two", " ", { images: ["/api/image?hash=a", "/api/image?hash=b"] }),
					prompt("skill", "", { skill: "review", images: ["/api/image?hash=c"] }),
				],
				false,
			),
		).toEqual([
			expect.objectContaining({ id: "one", prompt: "1 image", skill: null }),
			expect.objectContaining({ id: "two", prompt: "2 images", skill: null }),
			expect.objectContaining({ id: "skill", prompt: "1 image", skill: "review" }),
		]);
	});

	test("a later prompt led by go, or of approval words alone, approves or resumes; ok with more words, or a bare publish, is a prompt", () => {
		const nudge = (text: string, extra: Partial<Extract<Item, { kind: "user" }>> = {}) =>
			outline([prompt("first", "Plan it"), reply("plan", "The plan"), prompt("next", text, extra)], false)[1].nudge;
		expect(["go", "Yes go!", "go all don't commit", "fix all then push", "LGTM", "ok, continue", "go with the defaults", "go on https://linear.app/x/issue/ENG-1"].map(text => nudge(text))).toEqual(Array(8).fill("approve"));
		expect(["continue", "Continue please"].map(text => nudge(text))).toEqual(["resume", "resume"]);
		expect(["ok but rename it", "push", "Ship it", "gone", "continue with the tests", ""].map(text => nudge(text))).toEqual(Array(6).fill(null));
		expect(nudge("go", { skill: "review" })).toBeNull();
		expect(nudge("go", { images: ["/api/image?hash=a"] })).toBeNull();
		expect(outline([prompt("first", "go")], false)[0].nudge).toBeNull();
	});
});

describe("suggestions", () => {
	test("only the last turn's finished reply suggests, until a prompt follows it", () => {
		const prompt: Item = { id: "p", kind: "user", text: "go", skill: null, from: null, entryId: "p" };
		const reply = (streaming: boolean): Item => ({
			id: "r",
			kind: "assistant",
			text: "Done.\nSuggestions:\n1. Ship it",
			streaming,
			suggestions: streaming ? [] : ["Ship it"],
		});
		const tool: Item = { id: "t", kind: "tool", name: "bash", summary: "ls", status: "ok", agents: [] };
		expect(nextSuggestions([prompt, reply(false), tool], false)).toEqual(["Ship it"]);
		expect(nextSuggestions([prompt, reply(true)], true)).toEqual([]);
		expect(nextSuggestions([reply(false), prompt], false)).toEqual([]);
	});
});
