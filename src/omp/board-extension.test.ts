import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import boardExtension, { BOARD_FLAGS } from "./board-extension";
import { loadExtension } from "./fake-extension-api";
import { emptyBoard } from "../shared/board";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function loadedBoard() {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-board-extension-"));
	dirs.push(dir);
	const file = join(dir, "board.json");
	writeFileSync(file, JSON.stringify(emptyBoard("Max")));
	return loadExtension(boardExtension, new Map([[BOARD_FLAGS.file, file], [BOARD_FLAGS.inbox, join(dir, "inbox")]]));
}

const plan = [{ text: "Design", steps: [{ text: "Sketch" }, { text: "Review" }] }, { text: "Build" }];
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map(part => part.text).join("");
const numbered = (out: string) => out.split("\n").filter(line => line.includes("[ ]")).map(line => line.replace(/ \(t-.*$/, "").trim());

test("project and step each add a whole nested plan in one call, in order", async () => {
	const board = loadedBoard();
	await board.call("board", { action: "project", title: "Launch", text: "Ship it", steps: plan });
	await board.call("board", { action: "step", steps: [{ text: "Polish", steps: [{ text: "Copy" }] }] });
	expect(numbered(text(await board.call("board", { action: "projects" })))).toEqual(["[ ] 1 Design", "[ ] 1.1 Sketch", "[ ] 1.2 Review", "[ ] 2 Build", "[ ] 3 Polish", "[ ] 3.1 Copy"]);
});

test("steps past two levels are refused and add nothing", async () => {
	const board = loadedBoard();
	await board.call("board", { action: "project", title: "Launch", text: "Ship it" });
	const deep = [{ text: "A", steps: [{ text: "B", steps: [{ text: "C" }] }] }];
	expect(board.call("board", { action: "step", steps: deep })).rejects.toThrow("two levels at most");
	await board.call("board", { action: "step", steps: [{ text: "Top" }] });
	const top = text(await board.call("board", { action: "projects" })).match(/\((t-[^),]+)/)![1];
	expect(board.call("board", { action: "step", parent: top, steps: [{ text: "Sub", steps: [{ text: "Too deep" }] }] })).rejects.toThrow("two levels at most");
	expect(numbered(text(await board.call("board", { action: "projects" })))).toEqual(["[ ] 1 Top"]);
});
