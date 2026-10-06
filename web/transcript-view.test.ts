import { describe, expect, test } from "bun:test";
import type { Item } from "../src/shared";
import { applyItems, editablePrompt, forkPoints, nextSuggestions, toBlocks, turnReplies } from "./transcript-view";

describe("transcript rendering", () => {
	const user: Item = { id: "u", kind: "user", text: "go", skill: null, from: null, entryId: "e-u" };
	const tool = (id: string, status: "running" | "ok"): Item => ({ id, kind: "tool", name: "bash", summary: "ls", status, agents: [] });

	test("upserts keep position and append new ids", () => {
		const items = applyItems([user, tool("t1", "running")], false, [tool("t1", "ok"), tool("t2", "running")]);
		expect(items.map(item => (item.kind === "tool" ? `${item.id}:${item.status}` : item.id))).toEqual(["u", "t1:ok", "t2:running"]);
	});

	test("consecutive tools group into one block; a message splits groups", () => {
		const blocks = toBlocks([tool("t1", "ok"), tool("t2", "ok"), user, tool("t3", "running")]);
		expect(blocks.map(block => (block.kind === "tools" ? block.tools.map(t => t.id).join("+") : block.item.id))).toEqual([
			"t1+t2",
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
