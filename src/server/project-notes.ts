/** A project's notes: Markdown files every session of the project reads first and keeps current. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectNote } from "../shared/projects";

/** The files a new project starts with, by name; README.md comes first and indexes the rest. */
function seeds(name: string, goal: string): Record<string, string> {
	return {
		"README.md": [
			`# ${name}`,
			"",
			"## Goal",
			"",
			goal.trim(),
			"",
			"## Notes",
			"",
			"- [testing.md](testing.md): how to build, run, and test the work.",
			"- [preferences.md](preferences.md): how the user wants the work done.",
			"- [research.md](research.md): what agents found out, with sources.",
			"",
		].join("\n"),
		"testing.md": "# Testing\n\nHow to build, run, and test the work, as agents find out.\n",
		"preferences.md": "# Preferences\n\nHow the user wants the work done, as they say it.\n",
		"research.md": "# Research\n\nWhat agents found out, with sources.\n",
	};
}

/** Creates `dir` with the seed files for project `name` working on `goal`; a file already there stays. */
export function seedNotes(dir: string, name: string, goal: string): void {
	mkdirSync(dir, { recursive: true });
	for (const [file, text] of Object.entries(seeds(name, goal))) {
		const path = join(dir, file);
		if (!existsSync(path)) writeFileSync(path, text);
	}
}

/** The Markdown files in `dir`, README.md first then by name; none when `dir` is missing. */
export async function listNotes(dir: string): Promise<ProjectNote[]> {
	const names = await readdir(dir).catch(() => [] as string[]);
	const notes = await Promise.all(
		names
			.filter(name => name.endsWith(".md"))
			.map(async name => {
				const path = join(dir, name);
				const info = await stat(path).catch(() => null);
				return info?.isFile() ? { name, path, modifiedAt: info.mtime.toISOString() } : null;
			}),
	);
	return notes
		.filter(note => note !== null)
		.sort((a, b) => (a.name === "README.md" ? -1 : b.name === "README.md" ? 1 : a.name.localeCompare(b.name)));
}
