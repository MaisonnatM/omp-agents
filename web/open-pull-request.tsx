/**
 * **Open PR**: the prompt that has a live session commit, review, push, and open a pull request for its branch, which
 * sessions offer it, where a press of it stands, and the header's button; the command menu shares the same press.
 */
import { GitPullRequestCreate } from "lucide-react";
import { useEffect } from "react";
import type { LiveView, RosterHost, View } from "../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "../src/json";
import { useDashboardActions } from "./components/dashboard-context";
import { deliveryOf, subjectOf } from "./components/subject";
import { toasts } from "./components/toaster";
import { keyedStore } from "./keyed-store";
import { type PaneData, usePaneSelect } from "./pane-store";
import { opensTurn } from "./transcript-view";
import type { Dashboard } from "./use-dashboard";

/** What **Open PR** reads of a roster row. */
export type OpenPullRequestHost = Pick<RosterHost, "sessionId" | "branch" | "control" | "status" | "queue">;

/** `text` as one shell word: git lets a branch name hold `$`, `;`, and quotes. */
const shellWord = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * What **Open PR** sends a session on `branch`, which merges into `base`: commit, review the diff, apply the findings,
 * check, push, and open the pull request. It stops at an open pull request, so a second send changes nothing.
 */
export function openPullRequestPrompt(branch: string, base: string): string {
	const head = shellWord(branch);
	return `Open a pull request for the branch \`${branch}\` into \`${base}\`. When one is open for it already, report its link and stop. Otherwise commit the finished work on the branch, leaving out scratch files. Collect \`git diff ${shellWord(`origin/${base}`)}...HEAD\` and the full contents of every changed file, and spawn one \`task\` with \`agent: "thermo-nuclear-code-quality-review"\` (\`thermonuclear-reviewer\` when that agent is missing), passing them under \`### Git / diff output\` and \`### Changed file contents\`. Apply every finding that keeps behavior the same and stays inside the change's scope, and list each finding you skip with a one-line reason. Run the project's checks again, fix what they report, commit, and push with \`git push -u origin ${head}\`. Then open the pull request with \`gh pr create --base ${shellWord(base)} --head ${head}\`, with a short body: why, what changed, how you verified it, and the review findings applied and skipped. Do not merge it. Report its link.`;
}

/** The prompt **Open PR** sends `host` now; `null` unless the dashboard can prompt it and it works on a branch other than its repository's default branch that heads no pull request. */
export function offeredPrompt({ branch, control }: OpenPullRequestHost): string | null {
	if (control.phase !== "live" || control.readOnly) return null;
	if (!branch || branch.defaultBranch === null || branch.name === branch.defaultBranch || branch.pullRequest !== null) return null;
	return openPullRequestPrompt(branch.name, branch.defaultBranch);
}

/**
 * A press of **Open PR** under way: in `flight` until the session shows it took the prompt, with whether the server
 * answered the send; then `seen` until the session is next idle.
 */
export type Press = { phase: "flight"; prompt: string; answered: boolean } | { phase: "seen"; prompt: string };

/**
 * The press under way on `prompt` once `host`, whose transcript's last turn the prompt `last` opened, moved on from `press`;
 * `press` itself while nothing changed for it. A press is in `flight` until the session shows it took the prompt, by
 * queueing it or opening a turn with it, or until the server answered and the session is idle. Once seen, it stays `seen`
 * until the session is next idle with the prompt not queued, whatever is steered or queued after it; a session that waits
 * on a question, or whose status is not known yet, has not ended the turn. Without a press, the prompt is `seen` while
 * queued or while it opened the running turn, as when another page pressed it.
 */
export function pressAfter(prompt: string, host: OpenPullRequestHost, last: string | null, press: Press | null): Press | null {
	const queued = host.queue.steering.includes(prompt) || host.queue.followUp.includes(prompt);
	const idle = host.status === "idle";
	const seen = press?.phase === "seen" && press.prompt === prompt;
	if (queued || (!idle && last === prompt)) return seen ? press : { phase: "seen", prompt };
	if (press?.prompt !== prompt) return null;
	if (press.phase === "seen") return idle ? null : press;
	return last === prompt || (press.answered && idle) ? null : press;
}

/** Where a session stands on **Open PR**: not offered, ready with the prompt to send, or opening while its prompt is in flight or seen. */
export type OpenPullRequest = { kind: "none" } | { kind: "ready"; prompt: string } | { kind: "opening" };

const NONE: OpenPullRequest = { kind: "none" };
const OPENING: OpenPullRequest = { kind: "opening" };

/** The text of the prompt that opened a pane's last turn, the user's or the dashboard's. */
const lastPrompt = ({ items }: PaneData): string | null => items.findLast(opensTurn)?.text ?? null;

/** The press under way per session id. */
const presses = keyedStore<Press | null>(null);

/**
 * **Open PR** for the session `view` shows, whose roster row is `host`: where it stands, and `run`, which sends its
 * prompt as the composer would now, queued as a follow-up while a turn runs. A subagent's view, a past one, or none stands at `none`.
 * The header's button and the command menu both call it, and either one records the press as seen, or ends it, as the session moves.
 */
export function useOpenPullRequest(view: View | null, host: RosterHost | null | undefined, request: Dashboard["request"]): { state: OpenPullRequest; run: () => void } {
	const session: { view: LiveView; host: RosterHost } | null = view?.kind === "live" && view.agentId === null && host ? { view, host } : null;
	const last = usePaneSelect(session && session.view, lastPrompt);
	const key = session?.host.sessionId ?? "";
	const press = presses.use(key);
	const prompt = session && offeredPrompt(session.host);
	const next = session && prompt !== null ? pressAfter(prompt, session.host, last, press) : null;
	useEffect(() => {
		if (next !== press) presses.set(key, next);
	}, [next, press, key]);
	const state: OpenPullRequest = prompt === null ? NONE : next === null ? { kind: "ready", prompt } : OPENING;
	const run = (): void => {
		if (!session || state.kind !== "ready" || presses.get(key)) return;
		const sent: Press = { phase: "flight", prompt: state.prompt, answered: false };
		presses.set(key, sent);
		request({ t: "prompt", view: session.view, text: state.prompt, images: [], delivery: deliveryOf(subjectOf(session.view, session.host, null)) }).then(
			() => {
				if (presses.get(key) === sent) presses.set(key, { ...sent, answered: true });
			},
			(error: unknown) => {
				if (presses.get(key) === sent) presses.set(key, null);
				toasts.add({ title: "Could not send Open PR", description: errorText(error) });
			},
		);
	};
	return { state, run };
}

/**
 * **Open PR**, after the session's other controls, while it works on a branch other than its repository's default branch
 * that heads no pull request yet: it sends the session the prompt that reviews, pushes, and opens one, queued as a
 * follow-up while a turn runs, and reads `Opening PR…` from the press until the session is next idle after it took the prompt.
 */
export function OpenPullRequestButton({ view, host }: { view: LiveView; host: RosterHost | null }) {
	const { request } = useDashboardActions();
	const { state, run } = useOpenPullRequest(view, host, request);
	if (state.kind === "none") return null;
	const busy = state.kind === "opening";
	return (
		<Tooltip
			content={busy ? "The session is reviewing, pushing, and opening the pull request" : "Commit, review, push, and open a pull request for this branch, as the session's next turn"}
			side="bottom"
		>
			<Button variant="secondary" size="compact" leadingIcon={GitPullRequestCreate} disabled={busy} aria-busy={busy || undefined} onClick={run}>
				{busy ? "Opening PR…" : "Open PR"}
			</Button>
		</Tooltip>
	);
}
