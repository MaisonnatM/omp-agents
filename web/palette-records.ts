/** The todos, Linear tickets, and pull requests the command palette searches, each opening where the dashboard shows it. */
import { prKey, pullRequestName, pullRequestUrl, type RepoPullRequests } from "../src/shared/github";
import type { Ticket } from "../src/shared/tickets";
import type { UserTodo } from "../src/user-todos-shared";
import type { PaletteItem } from "./command-palette";
import { PAGE_ICON } from "./page-icons";
import { listedPullRequests } from "./pull-requests-model";
import { hashForOpenTodo, hashForPullRequests, hashForTickets } from "./routing";
import { TODO_STATUS } from "./todo-views";

export interface PaletteRecords {
	/** The todo list's top-level todos, each with its own. */
	todos: readonly UserTodo[];
	/** The Linear issues assigned to you. */
	tickets: readonly Ticket[];
	/** The open pull requests of the sidebar's workspace. */
	pullRequestRepos: readonly RepoPullRequests[];
}

/** One palette item for every todo, closed ones too, ticket, and pull request; a todo under another names its parent below its title. */
export function recordItems({ todos, tickets, pullRequestRepos }: PaletteRecords): PaletteItem[] {
	const todoItems = todos.flatMap(todo =>
		[todo, ...todo.children].map(
			(leaf): PaletteItem => ({
				id: `todo:${leaf.id}`,
				section: "todos",
				title: leaf.text,
				subtitle: leaf === todo ? undefined : todo.text,
				keywords: [],
				icon: PAGE_ICON.todo,
				accessories: [{ kind: "text", text: TODO_STATUS[leaf.status].label }],
				kind: "Todo",
				actions: [[{ id: "open", title: "Open todo", icon: PAGE_ICON.todo, run: { kind: "link", href: hashForOpenTodo(leaf.id, todo.categoryId) } }]],
			}),
		),
	);
	const ticketItems = tickets.map(
		(ticket): PaletteItem => ({
			id: `ticket:${ticket.id}`,
			section: "tickets",
			title: ticket.title,
			subtitle: ticket.id,
			keywords: [],
			icon: PAGE_ICON.tickets,
			accessories: [{ kind: "text", text: ticket.status }],
			kind: "Ticket",
			actions: [
				[
					{ id: "open", title: "Open ticket", icon: PAGE_ICON.tickets, run: { kind: "link", href: hashForTickets(ticket.id) } },
					{ id: "linear", title: "Open in Linear", icon: PAGE_ICON.tickets, run: { kind: "link", href: ticket.url, external: true } },
				],
			],
		}),
	);
	const pullRequestItems = listedPullRequests(pullRequestRepos).map((pr): PaletteItem => {
		const icon = PAGE_ICON["pull-requests"];
		return {
			id: `pr:${prKey(pr)}`,
			section: "pullRequests",
			title: pr.title,
			subtitle: pullRequestName(pr),
			keywords: [pr.head, pr.author.login],
			icon,
			accessories: [{ kind: "age", at: pr.updatedAt }],
			kind: "PR",
			actions: [
				[
					{ id: "open", title: "Open pull request", icon, run: { kind: "link", href: hashForPullRequests(pr) } },
					{ id: "github", title: "Open on GitHub", icon, run: { kind: "link", href: pullRequestUrl(pr), external: true } },
				],
			],
		};
	});
	return [...todoItems, ...ticketItems, ...pullRequestItems];
}
