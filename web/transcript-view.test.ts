import { describe, expect, test } from "bun:test";
import { parseBotId } from "../src/shared/bots";
import type { RoutineMessage } from "../src/shared/routine-message";
import type { Item } from "../src/shared/transcript";
import { type Block, nextSuggestions, resendOf, type TranscriptModel, transcriptModel, withEditedPrompt } from "./transcript-view";

const blocksOf = (items: Item[]): readonly Block[] => transcriptModel(items, false).blocks;
const ids = (blocks: readonly Block[]): string[] => blocks.map(block => (block.kind === "activity" ? block.id : block.item.id));

describe("transcript rendering", () => {
	const user: Item = { id: "u", kind: "user", text: "go", skill: null, from: null, entryId: "e-u" };
	const tool = (id: string, status: "running" | "ok"): Item => ({ id, kind: "tool", name: "bash", summary: "ls", status, agents: [] });

	const thinking = (id: string): Item => ({ id, kind: "thinking", text: "hmm", streaming: false });

	test("consecutive tools and thinking group into one block; a message splits groups", () => {
		const blocks = blocksOf([thinking("h1"), tool("t1", "ok"), tool("t2", "ok"), user, tool("t3", "running")]);
		expect(blocks.map(block => (block.kind === "activity" ? block.entries.map(entry => entry.id).join("+") : block.item.id))).toEqual([
			"h1+t1+t2",
			"u",
			"t3",
		]);
	});

	test("a block whose items did not change comes back as the same object, so a streamed token renders only its own row", () => {
		const reply = (text: string): Item => ({ id: "a", kind: "assistant", text, streaming: true, suggestions: [] });
		const t1 = tool("t1", "ok");
		const t2 = tool("t2", "running");
		const first = transcriptModel([user, t1, t2, reply("he")], true);
		const next = transcriptModel([user, t1, t2, reply("hel")], true, first);
		expect(next.blocks[0]).toBe(first.blocks[0]);
		expect(next.blocks[1]).toBe(first.blocks[1]);
		expect(next.blocks[2]).not.toBe(first.blocks[2]);
		const grown = transcriptModel([user, t1, t2, tool("t3", "running"), reply("hel")], true, next);
		expect(grown.blocks[0]).toBe(first.blocks[0]);
		expect(grown.blocks[1]).not.toBe(next.blocks[1]);
	});

	test("an edited prompt survives a reset and a new last prompt until the edit is settled", () => {
		const original: Extract<Item, { kind: "user" }> = { id: "old", kind: "user", text: "original", skill: null, from: null, entryId: "e-old" };
		const edit = { item: original, position: 1, submitted: null };
		const replacement: Item = { id: "new", kind: "user", text: "resent", skill: null, from: null, entryId: "e-new" };
		const empty = withEditedPrompt(blocksOf([]), edit);
		expect(empty).toEqual([{ kind: "item", item: { id: "old", kind: "user", text: "original", skill: null, from: null, entryId: "e-old" } }]);
		const afterReset = blocksOf([user, replacement]);
		const retained = withEditedPrompt(afterReset, edit);
		expect(ids(retained)).toEqual(["u", "old", "new"]);
		expect(transcriptModel([user, replacement], false).editable).toEqual({ itemId: "new", entryId: "e-new" });
		expect(ids(withEditedPrompt(afterReset, null))).toEqual(["u", "new"]);
		const replacedInPlace = withEditedPrompt(blocksOf([{ ...original, text: "changed on server" }]), edit);
		expect(replacedInPlace).toEqual([{ kind: "item", item: { id: "old", kind: "user", text: "original", skill: null, from: null, entryId: "e-old" } }]);
	});

	test("a submitted plain prompt at the edit's position is replaced by its editor exactly once until acknowledgment", () => {
		const original: Extract<Item, { kind: "user" }> = { id: "old", kind: "user", text: "original", skill: null, from: null, entryId: "e-old" };
		const replacement: Extract<Item, { kind: "user" }> = { id: "new", kind: "user", text: "resent", skill: null, from: null, entryId: "e-new" };
		const edit = { item: original, position: 1, submitted: "resent" };
		const replaced = blocksOf([user, replacement]);
		expect(ids(withEditedPrompt(replaced, edit))).toEqual(["u", "old"]);
		expect(ids(withEditedPrompt(replaced, null))).toEqual(["u", "new"]);
		for (const unrelated of [
			{ ...replacement, text: "unrelated prompt" },
			{ ...replacement, skill: "review" },
			{ ...replacement, images: ["image"] },
			{ ...replacement, files: [{ name: "file.txt", text: "" }] },
		]) {
			expect(ids(withEditedPrompt(blocksOf([user, unrelated]), edit))).toEqual(["u", "old", "new"]);
		}
		expect(ids(withEditedPrompt(replaced, { ...edit, submitted: null }))).toEqual(["u", "old", "new"]);
		expect(ids(withEditedPrompt(blocksOf([replacement, user]), edit))).toEqual(["new", "old", "u"]);
	});
});

describe("resendOf", () => {
	test("shows a resend's text while it runs and its failure after, only on the edit it sent", () => {
		const sent = { text: "resent" };
		const later = { text: "written after" };
		expect(resendOf(sent, { kind: "pending", args: [sent, "resent"] })).toEqual({ submitted: "resent", error: null });
		expect(resendOf(sent, { kind: "failed", args: [sent, "resent"], error: "offline" })).toEqual({ submitted: null, error: "offline" });
		expect(resendOf(later, { kind: "failed", args: [sent, "resent"], error: "offline" })).toEqual({ submitted: null, error: null });
		expect(resendOf(null, { kind: "pending", args: [sent, "resent"] })).toEqual({ submitted: null, error: null });
	});
});

describe("fork points", () => {
	const prompt = (id: string, entryId: string | null): Item => ({ id, kind: "user", text: id, skill: null, from: null, entryId });
	const reply = (id: string, streaming = false): Item => ({ id, kind: "assistant", text: id, streaming, suggestions: [] });
	const tool: Item = { id: "t", kind: "tool", name: "bash", summary: "ls", status: "ok", agents: [] };

	test("a prompt forks at itself; a turn's last reply forks at the next prompt, keeping the whole turn", () => {
		const items = [prompt("p1", "e1"), reply("r1a"), tool, reply("r1b"), prompt("p2", "e2"), reply("r2")];
		expect(Object.fromEntries(transcriptModel(items, false).forks)).toEqual({
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
		expect(Object.fromEntries(transcriptModel(items, false).forks)).toEqual({
			p1: { entryId: "e1", prefill: true },
			r2: { entryId: "e3", prefill: false },
			p3: { entryId: "e3", prefill: true },
			steer: { entryId: "e4", prefill: true },
		});
	});
});

describe("the editable prompt", () => {
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
	const editable = (items: Item[]) => transcriptModel(items, false).editable;

	test("only the last prompt is editable, through the replies after it", () => {
		expect(editable([prompt("p1", "e1"), reply, prompt("p2", "e2"), reply])).toEqual({ itemId: "p2", entryId: "e2" });
	});

	test("a last prompt omp has not saved yet leaves none editable, not the one before it", () => {
		expect(editable([prompt("p1", "e1"), reply, prompt("p2", null)])).toBeNull();
	});

	test("a skill prompt or one with images or files is not editable, since the edit resends text alone", () => {
		expect(editable([prompt("p1", "e1", { skill: "review" })])).toBeNull();
		expect(editable([prompt("p1", "e1", { images: ["data:image/png;base64,AA=="] })])).toBeNull();
		expect(editable([prompt("p1", "e1", { files: [{ name: "notes.md", text: "" }] })])).toBeNull();
	});
});

describe("turn replies", () => {
	const prompt = (id: string): Item => ({ id, kind: "user", text: id, skill: null, from: null, entryId: id });
	const reply = (id: string, text = id): Item => ({ id, kind: "assistant", text, streaming: false, suggestions: [] });
	const tool: Item = { id: "t", kind: "tool", name: "bash", summary: "ls", status: "ok", agents: [] };
	const items = [prompt("p1"), reply("r1a"), tool, reply("r1b"), reply("r1c", " "), prompt("p2"), reply("r2a"), tool, reply("r2b")];

	test("each turn's last reply with text, skipping the replies between its tool calls", () => {
		expect([...transcriptModel(items, false).replies]).toEqual(["r1b", "r2b"]);
	});

	test("a turn still running has no reply yet", () => {
		expect([...transcriptModel(items, true).replies]).toEqual(["r1b"]);
	});
});

describe("outline", () => {
	const prompt = (id: string, text: string, extra: Partial<Extract<Item, { kind: "user" }>> = {}): Item => ({ id, kind: "user", text, skill: null, from: null, entryId: id, ...extra });
	const reply = (id: string, text: string): Item => ({ id, kind: "assistant", text, streaming: false, suggestions: [] });
	const tool = (status: "ok" | "error"): Item => ({ id: `t-${status}`, kind: "tool", name: "bash", summary: "ls", status, agents: [] });
	const thinking: Item = { id: "th", kind: "thinking", text: "hmm", streaming: false };
	const items = [prompt("p1", "Fix it"), reply("r1a", "Looking"), thinking, tool("ok"), tool("error"), reply("r1b", " Fixed. "), prompt("p2", "Ship it"), reply("r2", "Shipping")];
	const outline = (items: Item[], working: boolean) => transcriptModel(items, working).outline;

	test("groups each prompt with its turn's final reply and counts the turn's tools and failures", () => {
		expect(outline(items, false)).toEqual([
			{ id: "p1", prompt: "Fix it", skill: null, routine: null, botMessage: null, nudge: null, reply: { id: "r1b", text: "Fixed." }, tools: 2, failed: 1, running: false },
			{ id: "p2", prompt: "Ship it", skill: null, routine: null, botMessage: null, nudge: null, reply: { id: "r2", text: "Shipping" }, tools: 0, failed: 0, running: false },
		]);
	});

	test("the turn still running has no reply until it ends, and only it runs", () => {
		const turns = outline(items, true);
		expect(turns.map(turn => [turn.id, turn.reply?.id ?? null, turn.running])).toEqual([
			["p1", "r1b", false],
			["p2", null, true],
		]);
	});

	test("a prompt without text reads as the files or images it carried, and a skill prompt keeps its skill", () => {
		expect(
			outline(
				[
					prompt("one", "", { images: ["data:image/png;base64,AA=="] }),
					prompt("two", " ", { images: ["/api/image?hash=a", "/api/image?hash=b"] }),
					prompt("skill", "", { skill: "review", images: ["/api/image?hash=c"] }),
					prompt("pasted", "", { files: [{ name: "Pasted text.txt", text: "a" }, { name: "notes.md", text: "b" }], images: ["/api/image?hash=d"] }),
				],
				false,
			),
		).toEqual([
			expect.objectContaining({ id: "one", prompt: "1 image", skill: null }),
			expect.objectContaining({ id: "two", prompt: "2 images", skill: null }),
			expect.objectContaining({ id: "skill", prompt: "1 image", skill: "review" }),
			expect.objectContaining({ id: "pasted", prompt: "Pasted text.txt, notes.md" }),
		]);
	});

	test("a later prompt led by go, or of approval words alone, approves or resumes; ok with more words, or a bare publish, is a prompt", () => {
		const nudge = (text: string, extra: Partial<Extract<Item, { kind: "user" }>> = {}) =>
			outline([prompt("first", "Plan it"), reply("plan", "The plan"), prompt("next", text, extra)], false)[1]!.nudge;
		expect(["go", "Yes go!", "go all don't commit", "fix all then push", "LGTM", "ok, continue", "go with the defaults", "go on https://linear.app/x/issue/ENG-1"].map(text => nudge(text))).toEqual(Array(8).fill("approve"));
		expect(["continue", "Continue please"].map(text => nudge(text))).toEqual(["resume", "resume"]);
		expect(["ok but rename it", "push", "Ship it", "gone", "continue with the tests", ""].map(text => nudge(text))).toEqual(Array(6).fill(null));
		expect(nudge("go", { skill: "review" })).toBeNull();
		expect(nudge("go", { images: ["/api/image?hash=a"] })).toBeNull();
		expect(outline([prompt("first", "go")], false)[0]!.nudge).toBeNull();
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

describe("a prompt the dashboard sent", () => {
	const prompt: Item = { id: "p1", kind: "user", text: "Migrate billing.", skill: null, from: null, entryId: "e1" };
	const update: Item = { id: "d1", kind: "dashboard", text: "[omp-agents] Project update.\n- w1 stopped.", entryId: "e2" };
	const reply = (id: string, suggestions: string[] = []): Item => ({ id, kind: "assistant", text: id, streaming: false, suggestions });
	const items = [prompt, reply("r1"), update, reply("r2", ["Merge it"])];

	test("renders nothing, but ends the turn before it, whose reply keeps its copy and fork buttons", () => {
		const model = transcriptModel(items, false);
		expect(ids(model.blocks)).toEqual(["p1", "r1", "r2"]);
		expect([...model.replies]).toEqual(["r1", "r2"]);
		expect(Object.fromEntries(model.forks)).toEqual({ p1: { entryId: "e1", prefill: true }, r1: { entryId: "e2", prefill: false } });
		expect(model.outline.map(turn => turn.prompt)).toEqual(["Migrate billing."]);
	});

	test("leaves the user's prompt before it not editable, since the edit would drop it, and lets its reply suggest", () => {
		expect(transcriptModel(items, false).editable).toBeNull();
		expect(nextSuggestions(items, false)).toEqual(["Merge it"]);
		expect(nextSuggestions([prompt, reply("r1", ["Ship it"]), update], false)).toEqual([]);
	});
});

describe("viewer images", () => {
	test("lists every prompt's and tool call's images in reading order, each captioned by its sender", () => {
		const items: Item[] = [
			{ id: "u", kind: "user", text: "look", skill: null, from: null, entryId: "u", images: ["/p.png"] },
			{ id: "tool:a", kind: "tool", name: "browser", summary: "screenshot", status: "ok", agents: [], images: ["/a1.png", "/a2.png"] },
			{ id: "tool:b", kind: "tool", name: "bash", summary: "ls", status: "ok", agents: [] },
			{ id: "tool:c", kind: "tool", name: "read", summary: "", status: "ok", agents: [], images: ["/c.png"] },
		];
		expect(transcriptModel(items, false).images).toEqual([
			{ id: "u", at: 0, src: "/p.png", caption: "Your message" },
			{ id: "tool:a", at: 0, src: "/a1.png", caption: "browser · screenshot" },
			{ id: "tool:a", at: 1, src: "/a2.png", caption: "browser · screenshot" },
			{ id: "tool:c", at: 0, src: "/c.png", caption: "read" },
		]);
	});
});

describe("a model built from the one before", () => {
	const prompt = (id: string, text = id): Item => ({ id, kind: "user", text, skill: null, from: null, entryId: `e-${id}` });
	const reply = (id: string, text: string, streaming: boolean): Item => ({ id, kind: "assistant", text, streaming, suggestions: [] });
	const todo = (id: string, content: string): Item => ({
		id,
		kind: "tool",
		name: "todo",
		summary: "",
		status: "ok",
		agents: [],
		todos: [{ name: "Work", tasks: [{ content, status: "in_progress" }] }],
	});
	const shot: Item = { id: "shot", kind: "tool", name: "browser", summary: "screenshot", status: "ok", agents: [], images: ["/s.png"] };
	const update: Item = { id: "d", kind: "dashboard", text: "[omp-agents] Project update.", entryId: "e-d" };
	const tool = (id: string, status: "ok" | "error"): Item => ({ id, kind: "tool", name: "bash", summary: "ls", status, agents: [] });

	test("matches the model built from scratch at every step, keeping settled turns and rows as the same objects", () => {
		const p1 = prompt("p1", "Fix it");
		const t1 = todo("t1", "Read the code");
		const r1 = reply("r1", "Fixed.", false);
		const steps: [Item[], boolean][] = [
			[[p1], true],
			[[p1, t1], true],
			[[p1, t1, reply("r1", "Fix", true)], true],
			[[p1, t1, reply("r1", "Fixed.", true)], true],
			[[p1, t1, r1], true],
			[[p1, t1, r1], false],
			[[p1, t1, r1, prompt("p2", "go")], true],
			[[p1, t1, r1, prompt("p2", "go"), shot, todo("t2", "Ship it")], true],
			[[p1, t1, r1, prompt("p2", "go"), shot, todo("t2", "Ship it"), update, reply("r2", "Shipped", false)], false],
			[[p1, t1, r1, prompt("p3", "continue")], false],
			[[prompt("q1", "Another view")], false],
			[[], false],
		];
		let model: TranscriptModel | undefined;
		let shown: Item[] = [];
		for (const [items, working] of steps) {
			const before = model;
			model = transcriptModel(items, working, before);
			expect(model).toEqual(transcriptModel(items, working));
			if (before && items[0] === shown[0] && items.length >= 3 && shown.length >= 3) {
				expect(model.blocks[0]).toBe(before.blocks[0]!);
				expect(model.blocks[1]).toBe(before.blocks[1]!);
			}
			shown = items;
		}
	});

	test("matches the model built from scratch around the turns' edges", () => {
		const early = tool("early", "ok");
		const late = tool("late", "ok");
		const p1 = prompt("p1");
		const r1 = reply("r1", "Done", false);
		const steps: [Item[], boolean][] = [
			[[], true],
			[[], false],
			[[early], true],
			[[early, update], true],
			[[early, update, late], true],
			[[early, update, late, p1], true],
			[[early, update, late, p1, r1], false],
			[[early, { ...update }, late, p1, r1], false],
			[[early, late, p1, r1], false],
			[[early, late, p1, reply("r1", "Redone", false)], false],
			[[p1, r1], false],
		];
		let model = transcriptModel([], false);
		for (const [items, working] of steps) {
			model = transcriptModel(items, working, model);
			expect(model).toEqual(transcriptModel(items, working));
		}
		expect(ids(transcriptModel([early, update, late, p1], false).blocks)).toEqual(["early", "p1"]);
	});

	test("matches the model built from scratch through random appends, replacements, removals, and working flips", () => {
		const message: RoutineMessage = { botId: parseBotId("scout")!, routine: { id: "r", name: "Triage" }, at: 1, triggeredBy: [], sent: { kind: "prompt", prompt: "Check the inbox." } };
		for (const seed of [1, 2, 3, 4, 5]) {
			let state = seed;
			// mulberry32: a small seeded generator, so a failure replays.
			const random = (): number => {
				state = (state + 0x6d2b79f5) | 0;
				let t = Math.imul(state ^ (state >>> 15), 1 | state);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
			const pick = <T,>(options: readonly T[]): T => options[Math.floor(random() * options.length)]!;
			let next = 0;
			const item = (): Item => {
				const id = `i${next++}`;
				const kind = pick(["user", "user", "routine", "dashboard", "assistant", "assistant", "thinking", "tool", "tool", "notice"] as const);
				switch (kind) {
					case "user":
						return {
							id,
							kind: "user",
							text: pick(["Fix it", "go", "continue", " "]),
							skill: pick([null, null, "review"]),
							from: null,
							entryId: pick([`e-${id}`, `e-${id}`, null]),
							...(random() < 0.2 ? { images: ["/p.png"] } : {}),
						};
					case "routine":
						return { id, kind: "routine", message, entryId: pick([`e-${id}`, null]) };
					case "dashboard":
						return { id, kind: "dashboard", text: "[omp-agents] Project update.", entryId: `e-${id}` };
					case "assistant":
						return { id, kind: "assistant", text: pick(["Done", " Fixed. ", "", " "]), streaming: random() < 0.3, suggestions: [] };
					case "thinking":
						return { id, kind: "thinking", text: "hmm", streaming: false };
					case "tool":
						return {
							id,
							kind: "tool",
							name: pick(["bash", "todo", "browser"]),
							summary: "ls",
							status: pick(["ok", "error", "running"]),
							agents: [],
							...(random() < 0.2 ? { images: ["/s.png"] } : {}),
							...(random() < 0.2 ? { todos: [{ name: "Work", tasks: [{ content: id, status: "pending" as const }] }] } : {}),
						};
					case "notice":
						return { id, kind: "notice", level: "info", text: "Compacted" };
					default: {
						const never: never = kind;
						throw new Error(`unknown kind ${never}`);
					}
				}
			};
			let items: Item[] = [];
			let working = false;
			let model = transcriptModel(items, working);
			for (let step = 0; step < 400; step++) {
				const at = Math.floor(random() * items.length);
				const change = pick(["append", "append", "append", "replace", "edit", "remove", "work", "reset"] as const);
				switch (change) {
					case "append":
						items = [...items, ...Array.from({ length: 1 + Math.floor(random() * 3) }, item)];
						break;
					case "replace":
						if (items.length > 0) items = items.with(at, item());
						break;
					case "edit":
						if (items.length > 0) items = items.with(at, { ...items[at]! });
						break;
					case "remove":
						if (items.length > 0) items = items.toSpliced(at, 1);
						break;
					case "work":
						working = !working;
						break;
					case "reset":
						if (random() < 0.2) items = [];
						break;
					default: {
						const never: never = change;
						throw new Error(`unknown change ${never}`);
					}
				}
				model = transcriptModel(items, working, model);
				expect(model).toEqual(transcriptModel(items, working));
			}
		}
	});

	test("a streamed token leaves the settled outline, forks, replies, images, and todos as the same objects", () => {
		const base = [prompt("p1"), todo("t1", "Plan"), shot, reply("r1", "Done", false), prompt("p2")];
		const first = transcriptModel([...base, reply("r2", "Wor", true)], true);
		const next = transcriptModel([...base, reply("r2", "Working", true)], true, first);
		expect(next.outline).toBe(first.outline);
		expect(next.forks).toBe(first.forks);
		expect(next.replies).toBe(first.replies);
		expect(next.images).toBe(first.images);
		expect(next.todos).toBe(first.todos);
		const done = transcriptModel([...base, reply("r2", "Working", false)], false, next);
		expect(done.outline[0]).toBe(first.outline[0]!);
		expect(done.outline[1]).not.toBe(first.outline[1]);
		expect(done.outline[1]!.reply).toEqual({ id: "r2", text: "Working" });
		expect(done.todos).toEqual([{ name: "Work", tasks: [{ content: "Plan", status: "in_progress" }] }]);
	});
});
