/** The project code the user trusted, saved in `project-trust.json`, and the check every dashboard start makes against it. */
import { ReducerFile } from "../fs";
import { canonical, mainCheckoutOf, worktreeAt } from "../git";
import { errorText, isObject } from "../json";
import { displayPath } from "../paths";
import { applyTrust, type ProjectTrust, type TrustAsk, type TrustChange, type TrustedProject, type UntrustedCode } from "../shared/project-trust";
import { projectCensus } from "./project-code";

const isHashes = (value: unknown): value is Record<string, string> => isObject(value) && Object.values(value).every(hash => typeof hash === "string");

export function parseProjectTrust(value: unknown): ProjectTrust | null {
	if (!isObject(value)) return null;
	const entries = Object.entries(value);
	return entries.every(([root, hashes]) => root.startsWith("/") && isHashes(hashes)) ? Object.fromEntries(entries) as ProjectTrust : null;
}

/** The error a start or a move refused for untrusted code fails with: all a bot, a schedule, the shepherd, or a move gets, and what the page shows under the start. */
export const untrustedText = (ask: TrustAsk): string =>
	`The agent code in ${ask.rootDisplay} is not trusted yet; a session started there from the dashboard asks you to review and trust it.`;

/** The same refusal for a start the page asked for, whose dialog offers the trust, rather than for a start nobody watches. */
export const refusedText = (ask: TrustAsk): string => `The agent code in ${ask.rootDisplay} is not trusted yet. Trust it to start a session there.`;

/** A start or a move refused because its directory runs project code the user has not trusted as it is now. */
export class UntrustedProjectError extends Error {
	constructor(readonly ask: TrustAsk) {
		super(untrustedText(ask));
	}
}

export class ProjectTrustFile extends ReducerFile<ProjectTrust, [TrustChange]> {
	constructor(path: string) {
		// Shared: every server on this computer trusts into one file, and a trust one page gives must not undo another's.
		super(path, { parse: parseProjectTrust, holds: "a list of trusted projects", empty: {}, reduce: applyTrust, shared: true });
	}

	/** The projects trusted, as Settings › Workspaces lists them. */
	projects(): TrustedProject[] {
		return Object.entries(this.value)
			.map(([root, hashes]) => ({ root, rootDisplay: displayPath(root), pieces: Object.keys(hashes).length }))
			.sort((a, b) => a.rootDisplay.localeCompare(b.rootDisplay));
	}

	/**
	 * The pieces of agent code a session in `dir` would run that this file holds no trust for as they are now, `null` when
	 * there are none. The file is read again first, for a trust another server on this computer saved.
	 */
	async untrustedCode(dir: string): Promise<TrustAsk | null> {
		const { root, top } = await projectOf(dir);
		const code = await projectCensus(dir, top);
		if (code.length === 0) return null;
		this.reload();
		const trusted = this.value[root] ?? {};
		const untrusted = code.flatMap((piece): UntrustedCode[] => (trusted[piece.id] === piece.hash ? [] : [{ ...piece, change: Object.hasOwn(trusted, piece.id) ? "changed" : "new" }]));
		return untrusted.length === 0 ? null : { root, rootDisplay: displayPath(root), code: untrusted };
	}

	/** Lets a session run in `dir`, or throws {@link UntrustedProjectError} when its project code is not trusted as it is now. */
	async admit(dir: string): Promise<void> {
		let ask: TrustAsk | null;
		try {
			ask = await this.untrustedCode(dir);
		} catch (error) {
			throw new Error(`Cannot check the agent code in ${dir}: ${errorText(error)}`);
		}
		if (ask) throw new UntrustedProjectError(ask);
	}
}

/**
 * Where trust for `dir` is kept, `root`, and the top of its checkout, `top`, which piece ids are relative to, both resolved
 * through symlinks: a repository's linked worktrees keep trust in its main checkout; a bare repository's worktree, in
 * itself; a directory outside git, in itself.
 */
export async function projectOf(dir: string): Promise<{ root: string; top: string }> {
	const at = await worktreeAt(dir);
	if (!at) {
		const real = await canonical(dir);
		return { root: real, top: real };
	}
	const top = await canonical(at.top);
	const main = mainCheckoutOf(at);
	return { root: main ? await canonical(main) : top, top };
}
