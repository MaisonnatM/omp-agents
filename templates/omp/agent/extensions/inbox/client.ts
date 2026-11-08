// What every tool that changes a dashboard file shares: the dashboard's config directory, and the inbox each one
// leaves its changes in, one file each, which the dashboard server applies and deletes. The server's own extensions
// import it too, so one copy names the inbox files.
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

/** One inbox, whose changes are `T`: `leave` one for the dashboard, or read those `waiting` for it. */
export interface Inbox<T> {
	leave(change: T): void;
	/** The changes the dashboard has not applied yet, oldest first, as their tools left them; a file that is not a JSON object is left out. */
	waiting(): T[];
}

let lastStamp = 0;

export function inbox<T extends object>(dir: string): Inbox<T> {
	return {
		// Written under a name the dashboard skips, then renamed, so it never reads half a file. Each name sorts after
		// the one before it, so the dashboard applies one session's changes in the order it left them, even two left in
		// the same millisecond.
		leave(change) {
			try {
				mkdirSync(dir, { recursive: true });
				lastStamp = Math.max(Date.now(), lastStamp + 1);
				const name = `${lastStamp}-${randomUUID()}`;
				const temp = join(dir, `${name}.tmp`);
				writeFileSync(temp, JSON.stringify(change));
				renameSync(temp, join(dir, `${name}.json`));
			} catch (error) {
				throw new Error(`Cannot leave the change for the dashboard: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
		waiting() {
			let names: string[] = [];
			try {
				names = readdirSync(dir)
					.filter(name => name.endsWith(".json"))
					.sort();
			} catch {
				return [];
			}
			return names.flatMap(name => {
				const change = readJson(join(dir, name));
				return typeof change === "object" && change !== null ? [change as T] : [];
			});
		},
	};
}

export const reply = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

/** A tool's `raw` parameters without the empty strings a model often sends for a parameter it means to leave out. */
export function withoutEmpty(raw: unknown): unknown {
	return typeof raw === "object" && raw !== null ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "")) : raw;
}
