/**
 * The notes sessions read and keep: a project's, which every session of the project shares, laid out as Cursor's
 * Project folder, and the user's, which every project shares, as Cursor's User folder.
 */
import { existsSync, linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errorText, isObject } from "../json";
import type { ProjectEvent, ProjectNote } from "../shared/projects";

/** The files a new project starts with, by path; notes.md comes first and indexes the rest. */
function projectSeeds(name: string, goal: string): Record<string, string> {
	return {
		"notes.md": [
			`# ${name}`,
			"",
			"## Goal",
			"",
			goal.trim(),
			"",
			"## Decisions",
			"",
			"What the user decided about this project, and how they want it done; a preference that holds beyond it goes in the user's preferences.md.",
			"",
			"## Notes",
			"",
			"- [docs/testing.md](docs/testing.md): how to build, run, and test the work.",
			"- [docs/research.md](docs/research.md): what agents found out, with sources.",
			"- [internal/checklist.md](internal/checklist.md): the coordinator's plan, each item of work and where it stands.",
			"- [archived.md](archived.md): finished work, moved out of the other notes.",
			"- `inbox/`: one file per outside event, such as a pull request's checks or a Linear issue, until it is handled.",
			"",
			"## Promoted",
			"",
			"Notes moved into the repository, as AGENTS.md lines or skills, so sessions outside the project have them too.",
			"",
		].join("\n"),
		"docs/testing.md": "# Testing\n\nHow to build, run, and test the work, as agents find out.\n",
		"docs/research.md": "# Research\n\nWhat agents found out, with sources.\n",
		"internal/checklist.md": "# Checklist\n\n| Item | Status | Worker | Pull request |\n| --- | --- | --- | --- |\n",
		"archived.md": "# Archived\n\nFinished work and handled events, moved out of the other notes.\n",
	};
}

/** The files the user's notes start with, by path. */
const USER_SEEDS: Record<string, string> = {
	"preferences.md": "# Preferences\n\nHow the user works across every project, as they say it; a preference about one project only goes in that project's notes.md.\n",
	"workflows/README.md":
		"# Workflows\n\nOne file per way of working that held across projects, such as a new feature's flow or a quality pass: its steps in order, and what each hands the next.\n",
};

/** Where an older version kept a project's notes, and where they live now. */
const MOVED: readonly (readonly [from: string, to: string])[] = [
	["README.md", "notes.md"],
	["testing.md", "docs/testing.md"],
	["research.md", "docs/research.md"],
	["preferences.md", "docs/preferences.md"],
	["checklist.md", "internal/checklist.md"],
];

/** Writes each of `files` under `dir` that is not there yet; a file already there stays, even one written meanwhile. */
function seed(dir: string, files: Record<string, string>): void {
	for (const [file, text] of Object.entries(files)) {
		const path = join(dir, file);
		mkdirSync(dirname(path), { recursive: true });
		try {
			writeFileSync(path, text, { flag: "wx" });
		} catch (error) {
			if (!(isObject(error) && error.code === "EEXIST")) throw error;
		}
	}
}

/**
 * Moves the notes an older version kept in project notes `dir` to their places now, each only when its place is free:
 * the move links the new name before it unlinks the old one, so it never replaces a file. Other files stay.
 */
export function moveOldNotes(dir: string): void {
	for (const [from, to] of MOVED) {
		const old = join(dir, from);
		if (!existsSync(old)) continue;
		const path = join(dir, to);
		try {
			mkdirSync(dirname(path), { recursive: true });
			linkSync(old, path);
			unlinkSync(old);
		} catch (error) {
			if (isObject(error) && (error.code === "EEXIST" || error.code === "ENOENT")) continue;
			console.error(`omp-agents: cannot move ${old} to ${path}: ${errorText(error)}`);
		}
	}
}

/** Creates `dir` with the seed files for project `name` working on `goal`, after moving older notes there; a file already there stays. */
export function seedNotes(dir: string, name: string, goal: string): void {
	mkdirSync(dir, { recursive: true });
	moveOldNotes(dir);
	seed(dir, projectSeeds(name, goal));
}

/** Creates the user's notes in `dir`; a file already there stays. */
export function seedUserNotes(dir: string): void {
	seed(dir, USER_SEEDS);
}

/** `text` as a file name's segment: lower case, dashes between words, at most 60 characters. */
function fileSlug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60)
			.replace(/-+$/, "") || "event"
	);
}

/**
 * Writes outside event `event`, which came at `at`, into the `inbox/` of project notes `dir`, named by its time then
 * its source and title, so the inbox lists oldest first; returns the file's path. A second event of the same name
 * takes a number rather than replacing the first.
 */
export function writeInboxEvent(dir: string, event: ProjectEvent, at: string): string {
	const inbox = join(dir, "inbox");
	mkdirSync(inbox, { recursive: true });
	const stem = `${at.replace(/\.\d+Z$/, "Z").replace(/:/g, "-")}-${fileSlug(`${event.source} ${event.title}`)}`;
	const lines = [`# ${event.title.replace(/\s+/g, " ").trim()}`, "", `- Source: ${event.source}`, `- Time: ${at}`];
	if (event.url) lines.push(`- URL: ${event.url}`);
	const text = [...lines, "", event.text.trim(), ""].join("\n");
	for (let n = 1; ; n++) {
		const path = join(inbox, `${n === 1 ? stem : `${stem}-${n}`}.md`);
		try {
			writeFileSync(path, text, { flag: "wx" });
			return path;
		} catch (error) {
			if (!(isObject(error) && error.code === "EEXIST")) throw error;
		}
	}
}

/** The Markdown files under `dir`, at any depth, each named by its path from `dir` with `/`, by name; hidden ones and missing directories list none. */
export async function listNotes(dir: string): Promise<ProjectNote[]> {
	const walk = async (prefix: string): Promise<ProjectNote[]> => {
		const entries = await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => []);
		const found = await Promise.all(
			entries
				.filter(entry => !entry.name.startsWith("."))
				.map(async (entry): Promise<ProjectNote[]> => {
					const name = prefix ? `${prefix}/${entry.name}` : entry.name;
					// A linked directory is not followed, so a link cannot loop.
					if (entry.isDirectory()) return walk(name);
					if (!entry.name.endsWith(".md")) return [];
					const path = join(dir, name);
					const info = await stat(path).catch(() => null);
					return info?.isFile() ? [{ name, path, modifiedAt: info.mtime.toISOString() }] : [];
				}),
		);
		return found.flat();
	};
	return (await walk("")).sort((a, b) => a.name.localeCompare(b.name));
}
