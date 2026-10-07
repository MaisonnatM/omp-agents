/**
 * The shapes the Todo page, the socket, and `todos.json` share.
 * The omp extension `templates/omp/agent/extensions/todos.ts` reads and writes the same file but cannot import `src/`, so it keeps its own copy of the file's shape: change it with this one.
 */

/** What a todo points to: a session it started or came from, a pull request, or a Linear issue. */
export type UserTodoLink =
	| { kind: "session"; sessionId: string }
	| { kind: "pull-request"; owner: string; repo: string; number: number }
	| { kind: "ticket"; identifier: string };

/** Where a todo stands, as Linear's workflow states go: not planned yet, planned, being worked on, then closed as done or canceled. */
export const TODO_STATUSES = ["backlog", "todo", "in-progress", "done", "canceled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/** Whether a todo with `status` is closed, which gives it a `doneAt`. */
export const isClosed = (status: TodoStatus): boolean => status === "done" || status === "canceled";

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low: Linear's scale, the same as `TicketPriority`. */
export type TodoPriority = 0 | 1 | 2 | 3 | 4;

export const TODO_PRIORITIES: readonly TodoPriority[] = [0, 1, 2, 3, 4];

/** A todo of your own, on the Todo page, under a top-level one. It holds none, so the list is two deep at most. */
export interface UserTodoLeaf {
	id: string;
	/** Its title, one line. */
	text: string;
	/** Its markdown content, `""` for none. */
	body: string;
	status: TodoStatus;
	priority: TodoPriority;
	/** When it was closed (Done or Canceled), as an ISO 8601 time; `null` while open. Set exactly when `status` is done or canceled. */
	doneAt: string | null;
	/** The day it is due, `YYYY-MM-DD`; `null` for none. */
	due: string | null;
	/** When it was added, as an ISO 8601 time; `null` for a todo from before this field. */
	createdAt: string | null;
}

/** A top-level todo of the Todo page, in category `categoryId` (`null` for none), with its own todos in order, which share its category. */
export interface UserTodo extends UserTodoLeaf {
	categoryId: string | null;
	children: UserTodoLeaf[];
	/** What it points to, each once, in the order they were linked. */
	links: UserTodoLink[];
	/** The session whose agent added it through omp's `user_todo` tool; `null` when you did. */
	addedBy: string | null;
}

/** A category of the Todo page, which the sidebar lists to show its todos alone. */
export interface UserTodoCategory {
	id: string;
	name: string;
}

/** The Todo page's categories and todos, each in order, and the todos **Clear done** put away, latest first. */
export interface UserTodoList {
	categories: UserTodoCategory[];
	todos: UserTodo[];
	archive: UserTodo[];
}

/**
 * One edit of the Todo page's list. A change that names no todo or category, or would nest a todo three deep, changes
 * nothing. The page picks every new `id`, so an add sent twice adds once.
 */
export type UserTodoChange =
	/**
	 * After todo `afterId` among `parentId`'s todos (the top level for `null`), or last for `null`. A top-level todo goes
	 * in category `categoryId`, or in none when that category is gone; one under another goes in its parent's. A top-level
	 * todo takes `links` and `addedBy`; any todo takes `body`, `due`, `status`, and `priority`. A closed `status` closes it at `createdAt`.
	 */
	| {
			op: "add";
			id: string;
			parentId: string | null;
			afterId: string | null;
			categoryId: string | null;
			text: string;
			body: string;
			due: string | null;
			links: UserTodoLink[];
			addedBy: string | null;
			status: TodoStatus;
			priority: TodoPriority;
			createdAt: string | null;
	  }
	| { op: "edit"; id: string; text: string }
	| { op: "edit-body"; id: string; body: string }
	/**
	 * Sets a todo's status; closing it (Done or Canceled) sets its `doneAt` to `at`, and reopening it clears that.
	 * Closing a top-level todo closes its open todos too, with the same status and time; reopening it leaves them.
	 */
	| { op: "set-status"; id: string; status: TodoStatus; at: string }
	| { op: "set-priority"; id: string; priority: TodoPriority }
	/** A todo of the list or of the archive, with its todos. */
	| { op: "remove"; id: string }
	/** Puts back a todo `remove` took at `index` among the top-level todos, or among top-level todo `parentId`'s, which holds leaves only. */
	| { op: "restore"; parentId: null; todo: UserTodo; index: number }
	| { op: "restore"; parentId: string; todo: UserTodoLeaf; index: number }
	/**
	 * A top-level todo goes right after top-level todo `afterId`, or first among category `categoryId`'s for `null`, and
	 * joins category `categoryId`. A todo under another goes after `afterId` among its parent's todos, or first for `null`.
	 */
	| { op: "move"; id: string; afterId: string | null; categoryId: string | null }
	| { op: "set-due"; id: string; due: string | null }
	/** On a top-level todo; a link it already holds changes nothing. */
	| { op: "link"; id: string; link: UserTodoLink }
	| { op: "unlink"; id: string; link: UserTodoLink }
	/** A top-level todo without todos of its own goes last under the top-level todo above it in its category. */
	| { op: "indent"; id: string }
	/** A todo under another goes to the top level right after it, and takes the todos below it along, so the list reads in the same order. */
	| { op: "outdent"; id: string }
	/** A top-level todo, with its todos, moves to category `categoryId`, or to none for `null`. */
	| { op: "categorize"; id: string; categoryId: string | null }
	/**
	 * Moves every closed todo (Done or Canceled) of category `categoryId`, or of the whole list for `null`, to the archive.
	 * A closed todo under an open one goes there as a top-level todo of its parent's category. With `before`, an ISO 8601
	 * time, only todos closed earlier go: the server's auto-clear sends it, and the socket and the todo inbox drop it.
	 */
	| { op: "clear-done"; categoryId: string | null; before?: string }
	/** An archived todo goes back last in the list, in its category when that still exists. */
	| { op: "unarchive"; id: string }
	| { op: "empty-archive" }
	/** Last among the categories. */
	| { op: "add-category"; id: string; name: string }
	| { op: "rename-category"; id: string; name: string }
	/** Its todos stay, in no category, archived ones too. */
	| { op: "remove-category"; id: string };
