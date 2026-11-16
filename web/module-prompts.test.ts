import { expect, test } from "bun:test";
import { deleteModulePrompt, editModulePrompt, newModulePrompt } from "./module-prompts";

const SPORT = { id: "sport", label: "Sport" };

test("a new module's prompt names it, says what it does, and asks for both halves only as needed, tests, docs, and a changelog line", () => {
	const prompt = newModulePrompt("  Reading ", " Track the books I read \n");
	expect(prompt.startsWith("Build a new omp-agents module named Reading.\n\nWhat it should do: Track the books I read\n\n")).toBe(true);
	expect(prompt).toContain("Follow docs/architecture/modules.md, § Adding a module.");
	expect(prompt).toContain("an `about` line");
	expect(prompt).toContain("only if it needs stored state or an agent tool");
	expect(prompt).toContain("Add tests, a row in the module table");
	expect(prompt).toContain("CHANGELOG.md line");
});

test("an edit's prompt names the module by label and id, says what changes, and keeps its id", () => {
	const prompt = editModulePrompt(SPORT, " Log climbs by color ");
	expect(prompt.startsWith("Change the omp-agents module Sport (id `sport`).\n\nWhat should change: Log climbs by color\n\n")).toBe(true);
	expect(prompt).toContain("module table in docs/architecture/modules.md");
	expect(prompt).toContain("Keep its id");
});

test("a removal's prompt reverses § Adding a module and leaves the saved data alone", () => {
	const prompt = deleteModulePrompt(SPORT);
	expect(prompt.startsWith("Remove the omp-agents module Sport (id `sport`).\n\n")).toBe(true);
	expect(prompt).toContain("§ Adding a module, in reverse");
	expect(prompt).toContain("`SERVER_MODULES`, `WEB_MODULES`, and `MODULE_VIEWS`");
	expect(prompt).toContain("Leave its saved data on disk untouched.");
	expect(prompt).toContain("CHANGELOG.md line");
});
