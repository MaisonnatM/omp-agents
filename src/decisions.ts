/** Reads a repository's decision records, the files the starter kit's `decision-records` skill writes. */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { worktreeAt } from "./git";
import { displayPath } from "./paths";
import type { DecisionRecord, DecisionRecords } from "./shared/models";

/** Where the skill looks for records, in its order: its own directory, then the usual ADR ones. */
const RECORD_DIRS = ["docs/decisions", "docs/adr", "doc/adr"];
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n*/;
const DATE = /^\d{4}-\d{2}-\d{2}/;

const names = (value: unknown): string[] => (value == null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]);

/** One record from its file's text; a record with no frontmatter or broken YAML still shows, with what the file holds. */
export function parseRecord(file: string, text: string): DecisionRecord {
	const name = file.replace(/\.md$/, "");
	const front = FRONTMATTER.exec(text);
	let fields: Record<string, unknown> = {};
	try {
		const parsed: unknown = front ? Bun.YAML.parse(front[1] ?? "") : null;
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
	} catch {}
	const rest = front ? text.slice(front[0].length) : text;
	const heading = /^# (.+)\n?/m.exec(rest);
	const date = fields.date instanceof Date ? fields.date.toISOString().slice(0, 10) : typeof fields.date === "string" ? fields.date : (DATE.exec(name)?.[0] ?? null);
	return {
		name,
		title: heading?.[1]?.trim() ?? name,
		status: typeof fields.status === "string" ? fields.status : null,
		date,
		decisionMakers: names(fields["decision-makers"]),
		supersedes: names(fields.supersedes),
		supersededBy: names(fields["superseded-by"]),
		body: (heading ? rest.slice(heading.index + heading[0].length) : rest).trim(),
	};
}

/** The records of the repository `cwd` is in, or of `cwd` itself outside git, newest first. */
export async function readDecisions(cwd: string): Promise<DecisionRecords> {
	const root = (await worktreeAt(cwd))?.top ?? cwd;
	for (const rel of RECORD_DIRS) {
		const dir = join(root, rel);
		if (!(await stat(dir).catch(() => null))?.isDirectory()) continue;
		const files = (await readdir(dir)).filter(file => file.endsWith(".md") && file.toLowerCase() !== "readme.md");
		const records = await Promise.all(files.map(async file => parseRecord(file, await readFile(join(dir, file), "utf8"))));
		records.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.name.localeCompare(a.name));
		return { dir, dirDisplay: displayPath(dir), records };
	}
	return { dir: null, dirDisplay: null, records: [] };
}
