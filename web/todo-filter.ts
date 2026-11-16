/** What the Todo page's list keeps and how it groups it: **Filter**, by priority, assignee, link, due day, and creation, and **Display**'s grouping. */
import { isObject, isTexts, oneOf, parseJson } from "../src/json";
import { addDays } from "../src/shared/days";
import {
	TODO_ASSIGNEES,
	TODO_PRIORITIES,
	type TodoAssignee,
	type TodoPriority,
	type TodoStatus,
	type UserTodo,
	type UserTodoLeaf,
	type UserTodoLink,
} from "../src/user-todos-shared";
import { DAY, type DayRange, type FilterOption, isDayRange } from "./list-filter";
import { PRIORITY_LABEL } from "./tickets-model";
import { earliestDue, STATUS_GROUPS } from "./todo-views";

/** A priority as **Filter** keys it, its digit. */
export type PriorityKey = `${TodoPriority}`;

export type LinkKind = UserTodoLink["kind"];

const LINK_KINDS: readonly LinkKind[] = ["session", "pull-request", "ticket"];

export const LINK_LABELS: Record<LinkKind, string> = { session: "Session", "pull-request": "Pull request", ticket: "Linear issue" };

/** Who a todo is assigned to, as its assignee picker names them. */
export const ASSIGNEE_LABELS: Record<TodoAssignee, string> = { user: "You", agent: "Agent" };

/** The priorities in the order Linear lists them: Urgent first, no priority last. */
export const PRIORITY_ORDER: readonly TodoPriority[] = [1, 2, 3, 4, 0];

const priorityKey = (priority: TodoPriority): PriorityKey => `${priority}`;

/** What **Filter** keeps; an empty set keeps every priority, assignee, or link, and `null` any day. */
export interface TodoFilter {
	priorities: ReadonlySet<PriorityKey>;
	assignees: ReadonlySet<TodoAssignee>;
	links: ReadonlySet<LinkKind>;
	/** Due within the next this many days, overdue included. */
	due: DayRange | null;
	/** Added within the last this many days. */
	created: DayRange | null;
}

export const NO_FILTER: TodoFilter = { priorities: new Set(), assignees: new Set(), links: new Set(), due: null, created: null };

/** Whether `filter` leaves anything out. */
export const filters = ({ priorities, assignees, links, due, created }: TodoFilter): boolean =>
	priorities.size > 0 || assignees.size > 0 || links.size > 0 || due !== null || created !== null;

const isPriorityKey = oneOf(TODO_PRIORITIES.map(priorityKey));
const isAssignee = oneOf(TODO_ASSIGNEES);
const isLinkKind = oneOf(LINK_KINDS);

/** The stored filter, with {@link NO_FILTER}'s value for each part that is missing or unreadable. */
export function decodeFilter(raw: string | null): TodoFilter {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return NO_FILTER;
	const { priorities, assignees, links, due, created } = stored;
	return {
		priorities: new Set(isTexts(priorities) ? priorities.filter(isPriorityKey) : []),
		assignees: new Set(isTexts(assignees) ? assignees.filter(isAssignee) : []),
		links: new Set(isTexts(links) ? links.filter(isLinkKind) : []),
		due: isDayRange(due) ? due : null,
		created: isDayRange(created) ? created : null,
	};
}

export const encodeFilter = ({ priorities, assignees, links, due, created }: TodoFilter): string =>
	JSON.stringify({ priorities: [...priorities], assignees: [...assignees], links: [...links], due, created });

export const PRIORITY_OPTIONS: readonly FilterOption<PriorityKey>[] = PRIORITY_ORDER.map(priority => ({ key: priorityKey(priority), label: PRIORITY_LABEL[priority] }));

export const ASSIGNEE_OPTIONS: readonly FilterOption<TodoAssignee>[] = TODO_ASSIGNEES.map(assignee => ({ key: assignee, label: ASSIGNEE_LABELS[assignee] }));

/** The link kinds **Filter** offers: those `todos` carry, each with how many todos carry it, and each of `checked` with none, so you can uncheck it. */
export function linkOptions(todos: readonly UserTodo[], checked: ReadonlySet<LinkKind>): FilterOption<LinkKind>[] {
	return LINK_KINDS.map(kind => ({ key: kind, label: LINK_LABELS[kind], count: todos.filter(todo => todo.links.some(link => link.kind === kind)).length })).filter(
		option => option.count > 0 || checked.has(option.key),
	);
}

/**
 * Whether top-level `todo` passes `filter` on `day`, at `now` in ms: its own priority and assignee, a link of a kind
 * checked, its earliest open due day within the next `due` days or past, and its creation within the last `created`
 * days; a todo from before creation times were kept passes no **Created**.
 */
export function keepsTodo(todo: UserTodo, { priorities, assignees, links, due, created }: TodoFilter, day: string, now: number): boolean {
	if (priorities.size > 0 && !priorities.has(priorityKey(todo.priority))) return false;
	if (assignees.size > 0 && (todo.assignee === null || !assignees.has(todo.assignee))) return false;
	if (links.size > 0 && !todo.links.some(link => links.has(link.kind))) return false;
	if (due !== null) {
		const earliest = earliestDue(todo);
		if (earliest === null || earliest > addDays(day, due)) return false;
	}
	if (created !== null && (todo.createdAt === null || Date.parse(todo.createdAt) < now - created * DAY)) return false;
	return true;
}

/** The list's headings, in menu order: by status, as the list always grouped, by priority, by assignee, or one list. */
export const GROUPINGS = ["status", "priority", "assignee", "none"] as const;

export type TodoGrouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<TodoGrouping, string> = { status: "Status", priority: "Priority", assignee: "Assignee", none: "No grouping" };

const isGrouping = oneOf(GROUPINGS);

/** What **Display** sets. */
export interface TodoDisplay {
	grouping: TodoGrouping;
}

export const DEFAULT_DISPLAY: TodoDisplay = { grouping: "status" };

export function decodeDisplay(raw: string | null): TodoDisplay {
	const stored = parseJson(raw ?? "null");
	if (!isObject(stored)) return DEFAULT_DISPLAY;
	return { grouping: isGrouping(stored.grouping) ? stored.grouping : DEFAULT_DISPLAY.grouping };
}

export const encodeDisplay = (display: TodoDisplay): string => JSON.stringify(display);

/** A heading of the list: a status, a priority's digit, an assignee or `none`, or `all` under no grouping. */
export type TodoGroup<T> =
	| { by: "status"; key: TodoStatus; todos: T[] }
	| { by: "priority"; key: TodoPriority; todos: T[] }
	| { by: "assignee"; key: TodoAssignee | null; todos: T[] }
	| { by: "none"; key: null; todos: T[] };

/**
 * `todos` under `grouping`, each group in the order `todos` has them: by status every status in `STATUS_GROUPS` order,
 * empty ones too, by priority Urgent first and none last, by assignee You, Agent, then no one, and under no grouping
 * one group; other groupings leave out the groups that hold no todo.
 */
export function groupTodos<T extends UserTodoLeaf>(grouping: TodoGrouping, todos: readonly T[]): TodoGroup<T>[] {
	switch (grouping) {
		case "status":
			return STATUS_GROUPS.map(status => ({ by: "status", key: status, todos: todos.filter(todo => todo.status === status) }));
		case "priority":
			return PRIORITY_ORDER.map((priority): TodoGroup<T> => ({ by: "priority", key: priority, todos: todos.filter(todo => todo.priority === priority) })).filter(
				group => group.todos.length > 0,
			);
		case "assignee":
			return [...TODO_ASSIGNEES, null]
				.map((assignee): TodoGroup<T> => ({ by: "assignee", key: assignee, todos: todos.filter(todo => todo.assignee === assignee) }))
				.filter(group => group.todos.length > 0);
		case "none":
			return todos.length === 0 ? [] : [{ by: "none", key: null, todos: [...todos] }];
	}
}

/**
 * A group's fold key, which the browser keeps: by status the status alone, as before there were groupings, else the
 * grouping and its key, so a priority's or an assignee's fold never folds a status, nor Done's default fold anything else.
 */
export function groupFoldKey(group: TodoGroup<unknown>): string {
	return group.by === "status" ? group.key : `${group.by}:${group.key ?? "none"}`;
}
