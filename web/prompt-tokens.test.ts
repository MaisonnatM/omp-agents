import { expect, test } from "bun:test";
import { promptTokens } from "./prompt-tokens";

const kinds = (text: string, options?: Parameters<typeof promptTokens>[1]) => promptTokens(text, options).map(({ kind, label, target }) => ({ kind, label, target }));

test("each reference the composer inserts reads back as its chip", () => {
	expect(
		kinds(
			'/skill:poteto-mode fix @web/app.tsx in @"docs/my notes.md" and @src/ for [ENG-12 Fix \\[x\\]](https://linear.app/acme/issue/ENG-12/fix) and [acme/app#7 Ship](https://github.com/acme/app/pull/7), todo "say \\"hi\\"" (id t-1) and omp session "Old run" (id s9)',
		),
	).toEqual([
		{ kind: "skill", label: "Poteto Mode", target: "poteto-mode" },
		{ kind: "file", label: "app.tsx", target: "web/app.tsx" },
		{ kind: "file", label: "my notes.md", target: "docs/my notes.md" },
		{ kind: "directory", label: "src/", target: "src/" },
		{ kind: "ticket", label: "ENG-12 Fix [x]", target: "https://linear.app/acme/issue/ENG-12/fix" },
		{ kind: "pull-request", label: "acme/app#7 Ship", target: "https://github.com/acme/app/pull/7" },
		{ kind: "todo", label: 'say "hi"', target: "t-1" },
		{ kind: "session", label: "Old run", target: "s9" },
	]);
});

test("a command or skill counts only where the prompt starts", () => {
	expect(kinds("/move there")).toEqual([{ kind: "command", label: "/move", target: "move" }]);
	expect(kinds("go /move there")).toEqual([]);
	expect(kinds("/skill:x", { leading: false })).toEqual([]);
});

test("a reference that ends at the caret is still being typed", () => {
	expect(kinds("/mo", { open: 3 })).toEqual([]);
	expect(kinds("see @web/ap", { open: 11 })).toEqual([]);
	expect(kinds("see @web/app.tsx now", { open: 20 })).toEqual([{ kind: "file", label: "app.tsx", target: "web/app.tsx" }]);
});

test("the @ menu's category prefixes and mid-word @ are not paths", () => {
	expect(kinds("@todo: @ticket:ENG user@host.com")).toEqual([]);
});
