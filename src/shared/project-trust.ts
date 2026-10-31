/** The agent code a project commits, which a dashboard session runs only once the user trusts it, and the projects trusted so far. */

/**
 * What a piece of project code is: a module omp imports, a slash command module, a server it spawns or connects to with
 * the project's settings, a settings file, whose keys may name commands to run, or a language server config.
 */
export type ProjectCodeKind = "extension" | "hook" | "tool" | "command" | "mcp-server" | "settings" | "lsp";

/** One piece of a project's agent code. */
export interface ProjectCode {
	kind: ProjectCodeKind;
	/** What trust is kept for: a file's path from the top of its checkout with `/` separators, or `mcp:<name>` for an MCP server. */
	id: string;
	/** SHA-256 of what the piece runs: its file, its package directory's files, or an MCP server's settings. */
	hash: string;
}

/** A piece a start found untrusted: never trusted, or trusted with other contents. */
export interface UntrustedCode extends ProjectCode {
	change: "new" | "changed";
}

/** The pieces a start found untrusted, and the project they belong to. */
export interface TrustAsk {
	/** The directory trust is kept for: the repository's main checkout, so its linked worktrees share one decision. */
	root: string;
	/** `root` as the page shows it, `~` for the home directory. */
	rootDisplay: string;
	code: UntrustedCode[];
}

/** A project the user trusted pieces of, as Settings › Workspaces lists it. */
export interface TrustedProject {
	root: string;
	rootDisplay: string;
	/** The pieces trusted, sorted. */
	ids: string[];
}

/** Trusts `code` in `root` as it is now, or forgets every piece trusted in `root`. */
export type TrustChange = { op: "trust"; root: string; code: { id: string; hash: string }[] } | { op: "forget"; root: string };

/** The hash each trusted piece had when it was trusted, by id, for each project root. */
export type ProjectTrust = Record<string, Record<string, string>>;

/** `trust` after `change`, or `trust` itself when it changes nothing. */
export function applyTrust(trust: ProjectTrust, change: TrustChange): ProjectTrust {
	switch (change.op) {
		case "trust": {
			const known = trust[change.root] ?? {};
			const changed = change.code.filter(({ id, hash }) => known[id] !== hash);
			if (changed.length === 0) return trust;
			return { ...trust, [change.root]: { ...known, ...Object.fromEntries(changed.map(({ id, hash }) => [id, hash])) } };
		}
		case "forget": {
			if (!Object.hasOwn(trust, change.root)) return trust;
			const { [change.root]: _forgotten, ...rest } = trust;
			return rest;
		}
		default: {
			const unknown: never = change;
			throw new Error(`Unknown trust change: ${JSON.stringify(unknown)}`);
		}
	}
}

/** The pieces of `code` that `trusted`, one project's trusted hashes, does not hold as they are now. */
export const untrustedOf = (code: readonly ProjectCode[], trusted: Readonly<Record<string, string>>): UntrustedCode[] =>
	code.flatMap(piece => (trusted[piece.id] === piece.hash ? [] : [{ ...piece, change: Object.hasOwn(trusted, piece.id) ? "changed" : "new" }]));

/** The label the trust dialog shows before a piece's path or server name. */
export function codeLabel(kind: ProjectCodeKind): string {
	switch (kind) {
		case "extension":
			return "Extension";
		case "hook":
			return "Hook";
		case "tool":
			return "Tool";
		case "command":
			return "Slash command";
		case "mcp-server":
			return "MCP server";
		case "settings":
			return "Settings";
		case "lsp":
			return "Language servers";
		default: {
			const unknown: never = kind;
			throw new Error(`Unknown project code kind: ${String(unknown)}`);
		}
	}
}

/** Why a start refused to run: the text a page shows under the start, and all a bot, a schedule, the shepherd, or a move gets. */
export const untrustedText = (ask: TrustAsk): string =>
	`The agent code in ${ask.rootDisplay} is not trusted yet; a session started there from the dashboard asks you to review and trust it.`;
