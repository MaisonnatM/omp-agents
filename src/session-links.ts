/**
 * Links from a pull request's description back to the dashboard sessions that submitted or worked on it. The
 * dashboard writes them only when the user asks, inside one marked block that a rerun replaces.
 */
import type { PullRequest, PullRequestLink, SessionLinksResult } from "./shared";
import { isObject } from "./transcript";

const GH_TIMEOUT_MS = 20_000;
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
			`- [Session ${sessionId.slice(0, 8)}](${origin}/#session/${encodeURIComponent(sessionId)}) ${link === "submitted" ? "submitted" : "worked on"} this pull request.`,
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

async function gh(args: string[], input?: string): Promise<string> {
	const child = Bun.spawn(["gh", ...args], {
		stdin: input === undefined ? "ignore" : new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
		timeout: GH_TIMEOUT_MS,
	});
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(stderr.trim() || `gh exited with code ${code}`);
	return stdout;
}

/** The pull request's description as GitHub holds it now; empty when it has none. */
export async function readDescription(pr: PullRequest): Promise<string> {
	const answer: unknown = JSON.parse(await gh(["api", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`]));
	const body = isObject(answer) ? answer.body : null;
	return typeof body === "string" ? body : "";
}

/** Write the sessions' block into the pull request's description; resolves whether the description changed. */
export async function linkSessions(pr: PullRequest, sessions: readonly SessionEntry[], origin: string): Promise<SessionLinksResult> {
	const body = await readDescription(pr);
	const next = mergeSessionLinks(body, sessionLinksBlock(origin, sessions));
	if (next === body) return { changed: false };
	await gh(["api", "--method", "PATCH", `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`, "--input", "-"], JSON.stringify({ body: next }));
	return { changed: true };
}
