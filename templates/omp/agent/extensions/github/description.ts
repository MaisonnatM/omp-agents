import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DescriptionSnapshot {
	body: string;
	updatedAt: string;
}
export type DescriptionChange =
	| { kind: "append"; text: string }
	| { kind: "replace-text"; oldText: string; newText: string }
	| { kind: "replace"; original: string; body: string; allowEmpty?: boolean };
export interface DescriptionIO {
	/** Must be a successful, uncached read, not stdout from an unchecked command. */
	read(): Promise<DescriptionSnapshot>;
	write(body: string): Promise<void>;
}

/** A REST pull request is a valid snapshot only when both its body and revision were actually read. */
export function descriptionSnapshot(value: unknown): DescriptionSnapshot {
	if (!value || typeof value !== "object" || !("body" in value) || !("updated_at" in value)
		|| (value.body !== null && typeof value.body !== "string") || typeof value.updated_at !== "string" || !value.updated_at) {
		throw new Error("GitHub did not return a complete PR description; nothing was written.");
	}
	return { body: value.body ?? "", updatedAt: value.updated_at };
}

/** Preserve the checked original before editing, then re-read immediately before writing. GitHub has no atomic body compare-and-swap. */
export async function editDescription(identity: string, change: DescriptionChange, io: DescriptionIO, backupDirectory = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "pr-body-backups")): Promise<{ changed: boolean; originalFile: string }> {
	const original = await io.read();
	mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
	const originalFile = join(backupDirectory, `${identity.replace(/[^\w.-]/g, "-")}-${randomUUID()}.txt`);
	writeFileSync(originalFile, original.body, { mode: 0o600, flag: "wx" });
	try {
		let body: string;
		switch (change.kind) {
			case "append":
				if (!change.text.trim()) throw new Error("The appended description text must not be empty.");
				body = original.body + (original.body && !original.body.endsWith("\n") ? "\n" : "") + change.text;
				break;
			case "replace-text": {
				if (!change.oldText || !original.body.includes(change.oldText)) throw new Error("The replacement anchor is absent; nothing was written.");
				if (original.body.indexOf(change.oldText) !== original.body.lastIndexOf(change.oldText)) throw new Error("The replacement anchor is ambiguous; nothing was written.");
				body = original.body.replace(change.oldText, () => change.newText);
				break;
			}
			case "replace":
				if (change.original !== original.body) throw new Error("The PR description changed since it was read. Reload it before editing; nothing was written.");
				body = change.body;
				break;
		}
		if (!body.trim() && !(change.kind === "replace" && change.allowEmpty === true)) throw new Error("Refusing an unintended empty PR description; nothing was written.");
		if (body.length > 65_536) throw new Error("The PR description exceeds GitHub's 65536-character limit; nothing was written.");
		if (body === original.body) return { changed: false, originalFile };
		const current = await io.read();
		if (current.body !== original.body || current.updatedAt !== original.updatedAt) throw new Error("The PR changed during this edit; nothing was written. Read it again before retrying.");
		await io.write(body);
		return { changed: true, originalFile };
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.message : String(error)} Original description preserved at ${originalFile}.`, { cause: error });
	}
}
