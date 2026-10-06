/**
 * Links from a pull request's description back to the dashboard sessions that submitted or worked on it. The
 * dashboard writes them only when the user asks, inside one marked block that a rerun replaces.
 */
import { ghGet, ghPatch } from "./github";
import { isObject } from "./json";
import type { PullRequest, PullRequestLink, SessionLinksResult } from "./shared/github";
import { hashForSession } from "./shared/sessions";

const START = "<!-- omp-sessions -->";
const END = "<!-- /omp-sessions -->";
/** Cursor's Bugbot keeps its summary at the end of the description, in a block that starts with this marker. */
const CURSOR_SUMMARY = "<!-- CURSOR_SUMMARY -->";
/** The block from the last start marker before its end marker, so that a stray start marker keeps the text after it. */
const BLOCK = /<!-- omp-sessions -->(?:(?!<!-- omp-sessions -->)[\s\S])*?<!-- \/omp-sessions -->/;

export interface SessionEntry {
	sessionId: string;
	link: PullRequestLink;
}

/** The marked block linking to each session at `origin`, the dashboard's `http://127.0.0.1:<port>`. */
export function sessionLinksBlock(origin: string, sessions: readonly SessionEntry[]): string {
	const lines = sessions.map(
		({ sessionId, link }) =>
			`- [Session ${sessionId.slice(0, 8)}](${origin}/${hashForSession(sessionId)}) ${link === "submitted" ? "submitted" : "worked on"} this pull request.`,
	);
	return [START, `**omp sessions.** These links open only on the machine that runs the omp-agents dashboard at ${origin}.`, "", ...lines, END].join("\n");
}

/** `body` with `block` in place of its marked block, else before Cursor's summary, else at the end. */
export function mergeSessionLinks(body: string, block: string): string {
	if (BLOCK.test(body)) return body.replace(BLOCK, () => block);
	const summary = body.indexOf(CURSOR_SUMMARY);
	const before = (summary < 0 ? body : body.slice(0, summary)).trimEnd();
	const after = summary < 0 ? "\n" : `\n\n${body.slice(summary)}`;
	return `${before ? `${before}\n\n` : ""}${block}${after}`;
}

/** The pull request's description as GitHub holds it now; empty when it has none. */
export async function readDescription(pr: PullRequest): Promise<string> {
	const answer = await ghGet(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
	const body = isObject(answer) ? answer.body : null;
	return typeof body === "string" ? body : "";
}

/** Write the sessions' block into the pull request's description; resolves whether the description changed. */
export async function linkSessions(pr: PullRequest, sessions: readonly SessionEntry[], origin: string): Promise<SessionLinksResult> {
	const body = await readDescription(pr);
	const next = mergeSessionLinks(body, sessionLinksBlock(origin, sessions));
	if (next === body) return { changed: false };
	await ghPatch(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`, { body: next });
	return { changed: true };
}
