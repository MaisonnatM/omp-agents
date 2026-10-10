/** The todos, Linear tickets, pull requests, and conversation matches the command palette searches, each opening where the dashboard shows it. */
import { AppWindow, Bot, Columns2, User } from "lucide-react";
import { prKey, pullRequestName, pullRequestUrl, type RepoPullRequests } from "../src/shared/github";
import type { ConversationHit, PastSession, RosterHost, View } from "../src/shared/sessions";
import type { Ticket } from "../src/shared/tickets";
import type { UserTodo } from "../src/user-todos-shared";
import type { Accessory, PaletteItem } from "./command-palette";
import { hostLabel, pastLabel } from "./labels";
import { PAGE_ICON } from "./page-icons";
import { listedPullRequests } from "./pull-requests-model";
import { hashForOpenTodo, hashForPullRequests, hashForTickets, type OpenMode } from "./routing";
import { type SessionEntry, viewOf } from "./session-actions";
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

/** Open `view`, whose session ran in `cwd`, in the focused pane or a split, scrolled to message `messageId`. */
export type OpenAt = (view: View, cwd: string, mode: OpenMode, messageId: string) => void;

/** The most conversation matches the palette lists. */
const MAX_CONVERSATION_ITEMS = 30;

/**
 * One palette item for each conversation match of a session the sidebar lists, the server's order kept, opening it at
 * the matching message, up to {@link MAX_CONVERSATION_ITEMS}; a match in a session the sidebar hides, such as one in `/tmp`, is left out.
 */
export function conversationItems(hits: readonly ConversationHit[], hosts: readonly RosterHost[], past: readonly PastSession[], openAt: OpenAt): PaletteItem[] {
	// A session that runs is listed live, so its live entry is set last and wins.
	const entries = new Map<string, SessionEntry>([
		...past.map(session => [session.sessionId, { kind: "past", session }] as const),
		...hosts.map(host => [host.sessionId, { kind: "live", host }] as const),
	]);
	return hits.flatMap((hit): PaletteItem[] => {
		const entry = entries.get(hit.sessionId);
		if (!entry) return [];
		const view = viewOf(entry);
		const { cwd } = entry.kind === "live" ? entry.host : entry.session;
		const matches: Accessory = { kind: "text", text: hit.matches === 1 ? "1 match" : `${hit.matches} matches` };
		const state: Accessory = entry.kind === "live" ? { kind: "status", status: entry.host.status } : { kind: "age", at: entry.session.modifiedAt };
		return [
			{
				id: `conversation:${hit.sessionId}`,
				section: "conversations",
				title: hit.snippet,
				subtitle: entry.kind === "live" ? hostLabel(entry.host) : pastLabel(entry.session),
				keywords: [],
				icon: hit.role === "user" ? User : Bot,
				accessories: [matches, state],
				kind: "Message",
				actions: [
					[
						{ id: "open", title: "Open at this message", icon: AppWindow, run: { kind: "do", fn: () => openAt(view, cwd, "replace", hit.messageId) } },
						{ id: "split", title: "Open in split at this message", icon: Columns2, run: { kind: "do", fn: () => openAt(view, cwd, "split", hit.messageId) } },
					],
				],
			},
		];
	}).slice(0, MAX_CONVERSATION_ITEMS);
}
