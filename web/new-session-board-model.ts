/** What the New session page's board lists: open todos, past sessions to resume, and pull requests whose move is yours that an agent can take. */
import type { PullRequestList, PullRequestSummary } from "../src/shared/github";
import { type AgentOn, type MoveId, moveOf, YOUR_MOVES } from "../src/shared/moves";
import type { PastSession } from "../src/shared/sessions";
import { isClosed, type UserTodo } from "../src/user-todos-shared";
import type { PullRequestActionId } from "../src/pull-request-actions";
import { MOVES, moveAction } from "./pull-requests-model";

/** How many rows each column shows. */
export const BOARD_ROWS = 4;

/** The open todos, in the Todo page's order: in progress first. */
export function boardTodos(todos: UserTodo[]): UserTodo[] {
	const open = todos.filter(todo => !isClosed(todo.status));
	return [...open.filter(todo => todo.status === "in-progress"), ...open.filter(todo => todo.status !== "in-progress")];
}

/** The omp sessions in `workspace` (`null` for all) that resume: interrupted first, then the latest. */
export function boardSessions(past: PastSession[], workspace: string | null): PastSession[] {
	return past
		.filter(session => session.source === "omp" && (workspace === null || session.cwd === workspace))
		.toSorted((a, b) => Number(b.interrupted) - Number(a.interrupted) || b.modifiedAt - a.modifiedAt);
}

export interface BoardPullRequest {
	pr: PullRequestSummary;
	move: MoveId;
	action: PullRequestActionId;
	/** The workspace a quick action starts in. */
	cwd: string;
}

const RANK = Object.keys(MOVES) as MoveId[];

/** The open pull requests whose move is yours and that a quick action hands to an agent, by move rank, then latest. */
export function boardPullRequests(list: PullRequestList | null, agentOn: AgentOn): BoardPullRequest[] {
	const rows: BoardPullRequest[] = [];
	for (const repo of list?.repos ?? []) {
		if (!("pullRequests" in repo) || repo.cwds.length === 0) continue;
		for (const pr of repo.pullRequests) {
			const move = moveOf(pr, agentOn(pr));
			if (!(YOUR_MOVES as readonly MoveId[]).includes(move)) continue;
			const action = moveAction(pr, move);
			if (action) rows.push({ pr, move, action, cwd: repo.cwds[0] });
		}
	}
	return rows.sort((a, b) => RANK.indexOf(a.move) - RANK.indexOf(b.move) || b.pr.updatedAt - a.pr.updatedAt);
}
