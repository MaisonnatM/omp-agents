/** What the New session page's board lists: open todos, past sessions to resume, and pull requests whose move is yours that an agent can take. */
import type { PullRequestList, PullRequestSummary } from "../src/shared/github";
import type { AgentOn, MoveId } from "../src/shared/moves";
import type { PastSession } from "../src/shared/sessions";
import { isClosed, type UserTodo } from "../src/user-todos-shared";
import type { PullRequestActionId } from "../src/pull-request-actions";
import { boardColumns, DEFAULT_ORDER, moveAction } from "./pull-requests-model";
import { byStatus } from "./todo-views";

/** How many rows each column shows. */
export const BOARD_ROWS = 4;

/** The open todos, grouped by status in the Todo page's order. */
export const boardTodos = (todos: UserTodo[]): UserTodo[] => byStatus(todos.filter(todo => !isClosed(todo.status))).flatMap(group => group.todos);

/** The omp sessions, which alone resume, in `workspace` (`null` for all): interrupted first, then the latest. */
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

/** The Pull requests board's **Your move** column, in its order, keeping the pull requests a quick action hands to an agent. */
export function boardPullRequests(list: PullRequestList | null, agentOn: AgentOn): BoardPullRequest[] {
	if (!list) return [];
	const yours = boardColumns(list, DEFAULT_ORDER, agentOn).find(({ title }) => title === "Your move")?.cards ?? [];
	return yours.flatMap(({ row: { pr, move }, cwd }) => {
		const action = moveAction(pr, move);
		return action ? [{ pr, move, action, cwd }] : [];
	});
}
