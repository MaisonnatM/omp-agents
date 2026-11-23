/** Finds named omp sessions and the request each started from, for `model-replay.ts candidates --sessions`. */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The top-level session files under `sessionsDir`, named `<cwd folder>/<time>_<id>.jsonl`, whose id is one of `ids` or
 * ends with one: `ship-trace.jsonl` names a session in full and a replay task names it by its last 8 characters.
 */
export function namedSessionFiles(sessionsDir: string, ids: readonly string[]): string[] {
	if (!existsSync(sessionsDir)) return [];
	const files: string[] = [];
	for (const folder of readdirSync(sessionsDir, { withFileTypes: true })) {
		if (!folder.isDirectory()) continue;
		for (const name of readdirSync(join(sessionsDir, folder.name))) {
			const id = name.match(/_([\w-]+)\.jsonl$/)?.[1];
			if (id && ids.some(wanted => id.endsWith(wanted))) files.push(join(sessionsDir, folder.name, name));
		}
	}
	return files;
}

const textOf = (content: unknown): string | null => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;
	const texts = content.flatMap(part => (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []));
	return texts.length > 0 ? texts.join("\n") : null;
};

/** A session's first request: what the model got, and the part of it the user wrote, without the text of a skill they invoked. */
export interface Request {
	prompt: string;
	written: string;
}

/**
 * The request a session started from: a subagent's task, else the first thing the user sent, either a message or a
 * skill they invoked, as omp expanded it with their words at its end.
 */
export function firstRequest(entries: readonly Record<string, unknown>[]): Request | null {
	for (const entry of entries) {
		if (entry.type === "session_init" && typeof entry.task === "string") return { prompt: entry.task, written: entry.task };
		if (entry.type === "custom_message" && entry.customType === "skill-prompt") {
			const prompt = textOf(entry.content);
			const { details } = entry;
			const args = details && typeof details === "object" && "args" in details && typeof details.args === "string" ? details.args : "";
			return prompt === null ? null : { prompt, written: args };
		}
		const message = entry.type === "message" ? entry.message : undefined;
		if (message && typeof message === "object" && "role" in message && message.role === "user") {
			const prompt = "content" in message ? textOf(message.content) : null;
			return prompt === null ? null : { prompt, written: prompt };
		}
	}
	return null;
}

/**
 * The checkout a session worked in: its `cwd` while it exists, else the repository a removed worktree of it,
 * `<repository>-wt/<name>`, belonged to; null when neither exists.
 */
export function survivingCheckout(cwd: string, exists: (path: string) => boolean = existsSync): string | null {
	if (exists(cwd)) return cwd;
	const repository = cwd.match(/^(.+)-wt\/[^/]+$/)?.[1];
	return repository && exists(repository) ? repository : null;
}
