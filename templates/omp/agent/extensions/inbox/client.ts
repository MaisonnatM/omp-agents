// What the user_note, user_todo, and user_event tools share: the dashboard's config directory, and the inbox each one
// leaves its changes in, one file each, which the dashboard server applies and deletes.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents");

/** What the file at `path` holds, or `null` when it is missing or not JSON. */
export function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/** The changes `inboxDir` holds that the dashboard has not applied yet, oldest first. */
export function waiting<T>(inboxDir: string): T[] {
	let names: string[] = [];
	try {
		names = readdirSync(inboxDir).filter(name => name.endsWith(".json")).sort();
	} catch {}
	return names.flatMap(name => {
		const change = readJson(join(inboxDir, name)) as T | null;
		return change ? [change] : [];
	});
}

/** Leaves `change` for the dashboard: written under a name it skips, then renamed, so it never reads half a file. */
export function leave(inboxDir: string, change: object): void {
	mkdirSync(inboxDir, { recursive: true });
	const name = `${Date.now()}-${randomUUID()}`;
	const temp = join(inboxDir, `${name}.tmp`);
	writeFileSync(temp, JSON.stringify(change));
	renameSync(temp, join(inboxDir, `${name}.json`));
}

export const reply = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

/** A tool's `raw` parameters without the empty strings a model often sends for a parameter it means to leave out. */
export function withoutEmpty(raw: unknown): unknown {
	return typeof raw === "object" && raw !== null ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "")) : raw;
}
