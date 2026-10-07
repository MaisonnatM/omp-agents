/** The composer's `@` menu: the sources it offers beside omp's files, the query a token asks, and the rows it shows. */
import { File, Folder, GitPullRequest, ListTodo, type LucideIcon, MessageSquare, Slash, Sparkles, Ticket } from "lucide-react";
import { prKey, pullRequestUrl, type RepoInbox } from "../src/shared/github";
import type { CompletionItem, PastSession, RosterHost } from "../src/shared/sessions";
import type { Ticket as LinearTicket } from "../src/shared/tickets";
import { type ChangedFile, fileStatus } from "../src/shared/transcript";
import type { UserTodo } from "../src/user-todos-shared";
import { mentionToken } from "./completion-trigger";
import { hostLabel, pastLabel } from "./labels";

export type SourceId = "todo" | "ticket" | "pull-request" | "session";

/** Something the menu offers besides a file; picking it puts `reference` in the draft, the text the agent reads. */
export interface Mention {
	source: SourceId;
	key: string;
	label: string;
	detail: string | null;
	reference: string;
}

/** What the page holds that the sources list. */
export interface MentionData {
	todos: UserTodo[];
	tickets: LinearTicket[];
	inbox: RepoInbox[];
	hosts: RosterHost[];
	past: PastSession[];
	/** The composer's own session, which the menu leaves out; `null` for the new-session draft. */
	sessionId: string | null;
}

/** A category of the home menu, which `@<prefix>:` narrows the menu to. */
interface Category {
	id: SourceId | "file";
	prefix: string;
	title: string;
	icon: LucideIcon;
}

export interface MentionSource extends Category {
	id: SourceId;
	list(data: MentionData): Mention[];
}

/** omp's own file search, which the server answers. */
const FILES: Category = { id: "file", prefix: "file", title: "Files & Folders", icon: Folder };

/** Brackets in a Markdown link's text would end it early. */
const linkText = (text: string): string => text.replace(/[[\]]/g, "\\$&");

export const MENTION_SOURCES: readonly MentionSource[] = [
	{
		id: "todo",
		prefix: "todo",
		title: "Todos",
		icon: ListTodo,
		list: ({ todos }) =>
			todos.flatMap(todo =>
				[todo, ...todo.children]
					.filter(leaf => leaf.doneAt === null)
					.map(leaf => ({
						source: "todo",
						key: leaf.id,
						label: leaf.text,
						detail: leaf === todo ? null : todo.text,
						reference: `todo ${JSON.stringify(leaf.text)} (id ${leaf.id})`,
					})),
			),
	},
	{
		id: "ticket",
		prefix: "ticket",
		title: "Tickets",
		icon: Ticket,
		list: ({ tickets }) =>
			tickets.map(ticket => ({
				source: "ticket",
				key: ticket.id,
				label: ticket.title,
				detail: ticket.id,
				reference: `[${linkText(`${ticket.id} ${ticket.title}`)}](${ticket.url})`,
			})),
	},
	{
		id: "pull-request",
		prefix: "pr",
		title: "Pull requests",
		icon: GitPullRequest,
		list: ({ inbox }) =>
			inbox.flatMap(repo => ("pullRequests" in repo ? repo.pullRequests : [])).map(pr => {
				const name = `${pr.owner}/${pr.repo}#${pr.number}`;
				return { source: "pull-request", key: prKey(pr), label: pr.title, detail: name, reference: `[${linkText(`${name} ${pr.title}`)}](${pullRequestUrl(pr)})` };
			}),
	},
	{
		id: "session",
		prefix: "session",
		title: "Sessions",
		icon: MessageSquare,
		list: ({ hosts, past, sessionId }) =>
			[
				...hosts.map(host => ({ id: host.sessionId, title: hostLabel(host), cwdDisplay: host.cwdDisplay })),
				...past.map(session => ({ id: session.sessionId, title: pastLabel(session), cwdDisplay: session.cwdDisplay })),
			]
				.filter(({ id }) => id !== sessionId)
				.map(({ id, title, cwdDisplay }) => ({ source: "session", key: id, label: title, detail: cwdDisplay, reference: `omp session ${JSON.stringify(title)} (id ${id})` })),
	},
];

const CATEGORIES: readonly (Category | MentionSource)[] = [FILES, ...MENTION_SOURCES];

export type MentionQuery =
	/** The token is `@` alone. */
	| { kind: "home" }
	| { kind: "search"; words: string }
	| { kind: "source"; source: SourceId | "file"; words: string };

/** The `@` token under the caret: where it starts, what it asks, and `typed`, what follows its prefix as typed, quotes kept. */
function tokenAt(text: string, cursor: number): { start: number; query: MentionQuery; typed: string } | null {
	const token = mentionToken(text, cursor);
	if (!token) return null;
	const { start, body } = token;
	if (body === "") return { start, query: { kind: "home" }, typed: "" };
	const prefix = /^([a-z]+):/.exec(body);
	const category = prefix && CATEGORIES.find(({ prefix: name }) => name === prefix[1]);
	const typed = category ? body.slice(prefix[0].length) : body;
	const words = typed.replace(/^"|"$/g, "");
	return { start, query: category ? { kind: "source", source: category.id, words } : { kind: "search", words }, typed };
}

/** What the `@` token under the caret asks for; `null` when the caret is in no such token. */
export function mentionQuery(text: string, cursor: number): MentionQuery | null {
	return tokenAt(text, cursor)?.query ?? null;
}

/**
 * The `complete` request whose files the menu shows: the draft with the token as the `@` mention omp completes, so
 * omp's answer replaces `@file:src` whole. `null` when the menu shows no files: home, or another source.
 */
export function fileSearch(text: string, cursor: number): { text: string; cursor: number } | null {
	const token = tokenAt(text, cursor);
	if (!token || token.query.kind === "home" || (token.query.kind === "source" && token.query.source !== "file")) return null;
	const mention = `@${token.typed}`;
	return { text: text.slice(0, token.start) + mention + text.slice(cursor), cursor: token.start + mention.length };
}

/** A row that picking applies: `edit` is the draft and caret after it, and a row that `opens` a category keeps the menu open. */
export interface MenuOption {
	key: string;
	icon: LucideIcon;
	label: string;
	detail: string | null;
	edit: { text: string; cursor: number };
	opens: boolean;
}

/** Rows under a heading; a section without one is set off from the one above by a line. */
export interface MenuSection {
	title: string | null;
	options: MenuOption[];
}

const ICON: Record<CompletionItem["kind"], LucideIcon> = { command: Slash, skill: Sparkles, file: File, directory: Folder };

/** omp's own suggestion, which carries the draft and caret it leaves. */
export function completionOption(item: CompletionItem): MenuOption {
	return { key: `${item.kind}:${item.label}`, icon: ICON[item.kind], label: item.label, detail: item.description, edit: { text: item.text, cursor: item.cursor }, opens: false };
}

/** Every word of `words` is in the mention's label, key, or detail, in any order and any case. */
function matches(mention: Mention, words: string): boolean {
	const text = [mention.label, mention.key, mention.detail ?? ""].join("\n").toLowerCase();
	return words.toLowerCase().split(/\s+/).every(word => text.includes(word));
}

const SEARCH_FILES = 5;
const SEARCH_MENTIONS = 3;
const SOURCE_LIMIT = 50;
const CHANGED_FILES = 3;

export interface MenuInput {
	text: string;
	cursor: number;
	data: MentionData;
	/** The files the view's agent changed, in first-touch order, relative to its directory when inside it. */
	changed: ChangedFile[];
	/** omp's answer to {@link fileSearch}; `null` until it arrives or when none was asked. */
	files: CompletionItem[] | null;
}

/** The menu for the `@` token under the caret; empty when the caret is in none. */
export function mentionMenu({ text, cursor, data, changed, files }: MenuInput): MenuSection[] {
	const token = tokenAt(text, cursor);
	if (!token) return [];
	const replace = (insert: string): MenuOption["edit"] => ({ text: text.slice(0, token.start) + insert + text.slice(cursor), cursor: token.start + insert.length });
	const { query } = token;
	if (query.kind === "home") {
		const recent = changed
			.filter(file => !/^[/~]/.test(file.path) && fileStatus(file.changes) !== "deleted")
			// Reversed first, so among files with no change time the later-touched one leads.
			.toReversed()
			.sort((a, b) => (b.changes.at(-1)?.at ?? 0) - (a.changes.at(-1)?.at ?? 0))
			.slice(0, CHANGED_FILES)
			.map(({ path }) => ({
				key: `changed:${path}`,
				icon: File,
				label: path,
				detail: null,
				// omp's own completion quotes a path with a space the same way.
				edit: replace(`${path.includes(" ") ? `@"${path}"` : `@${path}`} `),
				opens: false,
			}));
		const categories = CATEGORIES.map(category => ({
			key: `category:${category.id}`,
			icon: category.icon,
			label: category.title,
			detail: null,
			edit: replace(`@${category.prefix}:`),
			opens: true,
		}));
		return [...(recent.length > 0 ? [{ title: null, options: recent }] : []), { title: null, options: categories }];
	}
	const search = query.kind === "search";
	return CATEGORIES.filter(category => query.kind === "search" || category.id === query.source).flatMap(category => {
		const options =
			"list" in category
				? category
						.list(data)
						.filter(mention => matches(mention, query.words))
						.slice(0, search ? SEARCH_MENTIONS : SOURCE_LIMIT)
						.map(mention => ({
							key: `${mention.source}:${mention.key}`,
							icon: category.icon,
							label: mention.label,
							detail: mention.detail,
							edit: replace(`${mention.reference} `),
							opens: false,
						}))
				: (files ?? []).slice(0, search ? SEARCH_FILES : SOURCE_LIMIT).map(completionOption);
		return options.length > 0 ? [{ title: category.title, options }] : [];
	});
}
