/** The prompts Settings › Modules puts in a New session draft in the omp-agents checkout, to add, change, or remove a module's code. */

const GUIDE = "docs/architecture/modules.md";

/** The prompt that asks an agent to build a module named `name` that does `does`. */
export function newModulePrompt(name: string, does: string): string {
	return [
		`Build a new omp-agents module named ${name.trim()}.`,
		`What it should do: ${does.trim()}`,
		[
			`Follow ${GUIDE}, § Adding a module.`,
			"Give it a page half: a page definition with an `about` line, added to `WEB_MODULES`, and its `Page` and `Nav` in `MODULE_VIEWS`.",
			"Give it a server half in `SERVER_MODULES` only if it needs stored state or an agent tool.",
			`Add tests, a row in the module table of ${GUIDE}, the docs in docs/usage and docs/code-layout, and a CHANGELOG.md line.`,
		].join("\n"),
	].join("\n\n");
}

/** The prompt that asks an agent to change module `label`, whose id is `id`, as `change` says. */
export function editModulePrompt({ id, label }: { id: string; label: string }, change: string): string {
	return [
		`Change the omp-agents module ${label} (id \`${id}\`).`,
		`What should change: ${change.trim()}`,
		[
			`Its server and page definitions and its page components are in its row of the module table in ${GUIDE}.`,
			"Keep its id, so its saved data, addresses, and settings stay where they are.",
			"Update its tests and docs, and add a CHANGELOG.md line.",
		].join("\n"),
	].join("\n\n");
}

/** The prompt that asks an agent to remove module `label`, whose id is `id`. */
export function deleteModulePrompt({ id, label }: { id: string; label: string }): string {
	return [
		`Remove the omp-agents module ${label} (id \`${id}\`).`,
		[
			`Follow ${GUIDE}, § Adding a module, in reverse: take its entries out of \`SERVER_MODULES\`, \`WEB_MODULES\`, and \`MODULE_VIEWS\`, delete its files and tests, and remove its row from the module table.`,
			"Update the docs in docs/usage and docs/code-layout.",
			"Leave its saved data on disk untouched.",
			"Add a CHANGELOG.md line.",
		].join("\n"),
	].join("\n\n");
}
