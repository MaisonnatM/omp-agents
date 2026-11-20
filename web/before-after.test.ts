import { describe, expect, test } from "bun:test";
import type { Item } from "../src/shared/transcript";
import { latestBeforeAfter, MAX_BEFORE_AFTER, parseBeforeAfter, tweakPrompt } from "./before-after";

const reply = (id: string, text: string, streaming = false): Item => ({ id, kind: "assistant", text, streaming, suggestions: [] });
const fence = (changes: unknown): string => `Done.\n\n\`\`\`before-after\n${JSON.stringify(changes)}\n\`\`\``;
const change = { title: "Header", before: "/w/tmp/a.png", after: "/w/tmp/b.png", description: "Tighter header" };

describe("parseBeforeAfter", () => {
	test("keeps changes with a title and two absolute screenshots, each title once, up to the cap", () => {
		const many = Array.from({ length: MAX_BEFORE_AFTER + 2 }, (_, at) => ({ ...change, title: `C${at}` }));
		expect(parseBeforeAfter(JSON.stringify([{ ...change, title: " Header " }, { ...change, description: 3 }, { ...change, before: "tmp/a.png" }, { ...change, title: "" }, "x"]))).toEqual([change]);
		expect(parseBeforeAfter(JSON.stringify([{ title: "No text", before: "/a.png", after: "/b.png" }]))).toEqual([{ title: "No text", before: "/a.png", after: "/b.png", description: "" }]);
		expect(parseBeforeAfter(JSON.stringify(many))).toHaveLength(MAX_BEFORE_AFTER);
		expect(parseBeforeAfter("{not json")).toBeNull();
		expect(parseBeforeAfter(JSON.stringify(change))).toBeNull();
	});
});

describe("latestBeforeAfter", () => {
	test("reads the last valid list of a settled reply, skipping a streaming one", () => {
		const older = { ...change, title: "Older" };
		expect(latestBeforeAfter([reply("1", fence([older])), reply("2", `${fence([change])}\n\n\`\`\`before-after\nbroken\n\`\`\``), reply("3", fence([{ ...change, title: "Draft" }]), true)])).toEqual([change]);
		expect(latestBeforeAfter([reply("1", "No list here.")])).toEqual([]);
	});
});

describe("tweakPrompt", () => {
	test("names the change, its edited description, each noted pin on the after screenshot, and the ask", () => {
		const pins = [
			{ x: 12.4, y: 80.6, note: " Bigger gap " },
			{ x: 50, y: 50, note: "  " },
		];
		expect(tweakPrompt(change, "Header is 40px", pins, " Use the muted color ")).toBe(
			['Tweak "Header".', "", "What this change is: Header is 40px", "", "On the after screenshot `/w/tmp/b.png`:", "- At 12% across and 81% down: Bigger gap", "", "Use the muted color"].join("\n"),
		);
		expect(tweakPrompt(change, " ", [], "Revert the color")).toBe('Tweak "Header".\n\nRevert the color');
	});
});
