/** What the New session page's board lists: prompts to start common work with, past sessions to resume, and pull requests whose move is yours that an agent can take. */
import type { PullRequestList, PullRequestSummary } from "../src/shared/github";
import type { AgentOn, MoveId } from "../src/shared/moves";
import type { PastSession } from "../src/shared/sessions";
import type { PullRequestActionId } from "../src/pull-request-actions";
import { boardColumns, DEFAULT_ORDER, moveAction } from "./pull-requests-model";
import { workspaceCwd } from "./sessions";

/** How many rows each column shows. */
export const BOARD_ROWS = 4;

/** A prompt the Starters column puts in the draft, unsent, under a short name. */
export interface Starter {
	label: string;
	prompt: string;
}

/** The work you start sessions for again and again; `/ship ` waits for the Linear issue or view you paste after it. */
export const STARTERS: readonly Starter[] = [
	{ label: "Run the dev server", prompt: "Start the dev server on this branch and give me the URL" },
	{ label: "Ship a Linear issue", prompt: "/ship " },
	{ label: "Shepherd my pull requests", prompt: "Shepherd my open PRs until merged: rebase, fix CI, answer review threads" },
	{ label: "Sum up my week", prompt: "Summarize what I merged this week across my repos" },
	{ label: "Prune my Linear todos", prompt: "Review my Linear todos for staleness and propose what to close" },
	{ label: "Update omp and pstack", prompt: "Update omp and check pstack is on its latest version" },
	{ label: "Find who changed this checkout", prompt: "Find which session made the uncommitted changes in this checkout" },
];

/** The omp sessions, which alone resume, in `workspace` (`null` for all): interrupted first, then the latest. */
export function boardSessions(past: PastSession[], workspace: string | null): PastSession[] {
	return past
		.filter(session => session.source === "omp" && (workspace === null || workspaceCwd(session) === workspace))
		.toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted) || b.modifiedAt - a.modifiedAt);
}

export interface BoardPullRequest {
	pr: PullRequestSummary;
	move: MoveId;
	action: PullRequestActionId;
	/** The workspace a quick action starts in. */
	cwd: string;
}

/** The Pull requests board's **Your move** column, in its order, keeping the pull requests a quick action hands to an agent. */
export function boardPullRequests(list: PullRequestList | null, agentOn: AgentOn): BoardPullRequest[] {
	if (!list) return [];
	const yours = boardColumns(list, DEFAULT_ORDER, agentOn).find(({ title }) => title === "Your move")?.cards ?? [];
	return yours.flatMap(({ row: { pr, move }, cwd }) => {
		const action = moveAction(pr, move);
		return action ? [{ pr, move, action, cwd }] : [];
	});
}
