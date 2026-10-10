/** The composer's `@` menu: the categories it offers, the query a token asks, and the rows it shows. */
import { File, Folder, GitPullRequest, ListTodo, type LucideIcon, MessageSquare, Slash, Sparkles, Ticket } from "lucide-react";
import { pullRequestName, pullRequestUrl, type RepoPullRequests } from "../src/shared/github";
import type { CompletionItem, PastSession, RosterHost } from "../src/shared/sessions";
import type { Ticket as LinearTicket } from "../src/shared/tickets";
import { type ChangedFile, fileStatus } from "../src/shared/transcript";
import type { UserTodo } from "../src/user-todos-shared";
import type { MentionToken } from "./completion-trigger";
import { everyWord } from "./every-word";
import { isAbsolutePath } from "./file-paths";
import { hostLabel, pastLabel } from "./labels";
import { listedPullRequests } from "./pull-requests-model";

export type CategoryId = "file" | "todo" | "ticket" | "pull-request" | "session";

/** The page's lists that every composer shares. */
export interface MentionLists {
	todos: UserTodo[];
	hosts: RosterHost[];
	past: PastSession[];
}

/** What the sources list: the page's lists, then the tickets the menu polls while it needs them and the selected workspace's pull requests. */
export interface MentionData extends MentionLists {
	tickets: LinearTicket[];
	pullRequestRepos: RepoPullRequests[];
}

/** The composer the menu opens in. */
export interface Composer {
	/** Its session, which the menu leaves out; `null` for the new-session draft. */
	sessionId: string | null;
	/** The files its agent changed, in first-touch order. */
	changed: ChangedFile[];
}

/** The draft and caret a row leaves. */
export interface Edit {
	text: string;
	cursor: number;
}

/** A row that picking applies; a row that `opens` a category keeps the menu open. */
export interface MenuOption {
	icon: LucideIcon;
	label: string;
	detail: string | null;
	edit: Edit;
	opens: boolean;
}

/** Rows under a heading; a section without one is set off from the one above by a line. */
export interface MenuSection {
	title: string | null;
	options: MenuOption[];
}

interface CategoryInput {
	words: string;
	data: MentionData;
	composer: Composer;
	/** omp's answer to {@link fileSearch}, empty until it arrives. */
	files: CompletionItem[];
	/** The draft with the `@` token replaced by `insert`. */
	replace: (insert: string) => Edit;
}

/** A row of the home menu, which `@<prefix>:` narrows the menu to. */
interface Category {
	id: CategoryId;
	prefix: string;
	title: string;
	icon: LucideIcon;
	/** How many rows a search across every category shows. */
	searchLimit: number;
	/** The rows matching `words`. */
	options(input: CategoryInput): MenuOption[];
}

/** Something a source offers; picking it puts `reference` in the draft, the text the agent reads. */
interface Mention {
	label: string;
	detail: string | null;
	reference: string;
}

/** A category the page answers, filtering what `list` gives. */
function source({ list, ...category }: Omit<Category, "searchLimit" | "options"> & { list(data: MentionData, composer: Composer): Mention[] }): Category {
	return {
		...category,
		searchLimit: 3,
		options: ({ words, data, composer, replace }) => {
			const holds = everyWord(words);
			return list(data, composer)
				.filter(({ label, detail }) => holds(`${label}\n${detail ?? ""}`))
				.map(({ label, detail, reference }) => ({ icon: category.icon, label, detail, edit: replace(`${reference} `), opens: false }));
		},
	};
}

const COMPLETION_ICON: Record<CompletionItem["kind"], LucideIcon> = { command: Slash, skill: Sparkles, file: File, directory: Folder };

/** omp's own suggestion, which carries the draft and caret it leaves. */
export function completionOption(item: CompletionItem): MenuOption {
	return { icon: COMPLETION_ICON[item.kind], label: item.label, detail: item.description, edit: { text: item.text, cursor: item.cursor }, opens: false };
}

/** Brackets in a Markdown link's text would end it early. */
const linkText = (text: string): string => text.replace(/[[\]]/g, "\\$&");

const CATEGORIES: readonly Category[] = [
	{ id: "file", prefix: "file", title: "Files & Folders", icon: Folder, searchLimit: 5, options: ({ files }) => files.map(completionOption) },
	source({
		id: "todo",
		prefix: "todo",
		title: "Todos",
		icon: ListTodo,
		list: ({ todos }) =>
			todos.flatMap(todo =>
				[todo, ...todo.children]
					.filter(leaf => leaf.doneAt === null)
					.map(leaf => ({ label: leaf.text, detail: leaf === todo ? null : todo.text, reference: `todo ${JSON.stringify(leaf.text)} (id ${leaf.id})` })),
			),
	}),
	source({
		id: "ticket",
		prefix: "ticket",
		title: "Tickets",
		icon: Ticket,
		list: ({ tickets }) => tickets.map(ticket => ({ label: ticket.title, detail: ticket.id, reference: `[${linkText(`${ticket.id} ${ticket.title}`)}](${ticket.url})` })),
	}),
	source({
		id: "pull-request",
		prefix: "pr",
		title: "Pull requests",
		icon: GitPullRequest,
		list: ({ pullRequestRepos }) =>
			listedPullRequests(pullRequestRepos).map(pr => {
				const name = pullRequestName(pr);
				return { label: pr.title, detail: name, reference: `[${linkText(`${name} ${pr.title}`)}](${pullRequestUrl(pr)})` };
			}),
	}),
	source({
		id: "session",
		prefix: "session",
		title: "Sessions",
		icon: MessageSquare,
		list: ({ hosts, past }, { sessionId }) =>
			[
				...hosts.map(host => ({ id: host.sessionId, title: hostLabel(host), cwdDisplay: host.cwdDisplay })),
				...past.map(session => ({ id: session.sessionId, title: pastLabel(session), cwdDisplay: session.cwdDisplay })),
			]
				.filter(({ id }) => id !== sessionId)
				.map(({ id, title, cwdDisplay }) => ({ label: title, detail: cwdDisplay, reference: `omp session ${JSON.stringify(title)} (id ${id})` })),
	}),
];

export type MentionQuery =
	/** The token is `@` alone. */
	| { kind: "home" }
	| { kind: "search"; words: string }
	| { kind: "source"; category: CategoryId; words: string };

/** The token's category, and what follows its prefix as typed; an unknown prefix stays part of what was typed. */
function categoryOf({ prefix, body }: MentionToken): { category: Category | undefined; typed: string } {
	const category = CATEGORIES.find(candidate => candidate.prefix === prefix);
	return { category, typed: category || prefix === null ? body : `${prefix}:${body}` };
}

/** What the `@` token asks for. */
export function mentionQuery(token: MentionToken): MentionQuery {
	const { category, typed } = categoryOf(token);
	const words = typed.replace(/^"|"$/g, "");
	if (category) return { kind: "source", category: category.id, words };
	return typed === "" ? { kind: "home" } : { kind: "search", words };
}

/** Whether the query shows category `id`'s rows. */
export function wants(query: MentionQuery, id: CategoryId): boolean {
	return query.kind === "search" || (query.kind === "source" && query.category === id);
}

/**
 * The `complete` request whose files the menu shows: the draft with the token as the `@` mention omp completes, so
 * omp's answer replaces `@file:src` whole. `null` when the menu shows no files: home, or another category.
 */
export function fileSearch(text: string, token: MentionToken): Edit | null {
	const { category, typed } = categoryOf(token);
	if (category ? category.id !== "file" : typed === "") return null;
	const mention = `@${typed}`;
	return { text: text.slice(0, token.start) + mention + text.slice(token.end), cursor: token.start + mention.length };
}

/** The last `count` files the agent changed inside its directory and did not delete, latest first. */
function recentlyChanged(changed: ChangedFile[], count: number): string[] {
	const lastAt = (file: ChangedFile): number => file.changes[file.changes.length - 1].at ?? 0;
	return changed
		.map((file, index) => ({ file, index }))
		.filter(({ file }) => !isAbsolutePath(file.path) && fileStatus(file.changes) !== "deleted")
		.sort((a, b) => lastAt(b.file) - lastAt(a.file) || b.index - a.index)
		.slice(0, count)
		.map(({ file }) => file.path);
}

export interface MenuInput {
	/** The draft `token` was read from. */
	text: string;
	token: MentionToken;
	data: MentionData;
	composer: Composer;
	/** omp's answer to {@link fileSearch}; `null` until it arrives or when none was asked. */
	files: CompletionItem[] | null;
}

/** The menu for the `@` token. */
export function mentionMenu({ text, token, data, composer, files }: MenuInput): MenuSection[] {
	const replace = (insert: string): Edit => ({ text: text.slice(0, token.start) + insert + text.slice(token.end), cursor: token.start + insert.length });
	const query = mentionQuery(token);
	if (query.kind === "home") {
		const recent = recentlyChanged(composer.changed, 3).map(path => ({
			icon: File,
			label: path,
			detail: null,
			// omp's own completion quotes a path with a space the same way.
			edit: replace(`${path.includes(" ") ? `@"${path}"` : `@${path}`} `),
			opens: false,
		}));
		const categories = CATEGORIES.map(category => ({ icon: category.icon, label: category.title, detail: null, edit: replace(`@${category.prefix}:`), opens: true }));
		return [...(recent.length > 0 ? [{ title: null, options: recent }] : []), { title: null, options: categories }];
	}
	return CATEGORIES.filter(category => wants(query, category.id)).flatMap(category => {
		const options = category
			.options({ words: query.words, data, composer, files: files ?? [], replace })
			.slice(0, query.kind === "search" ? category.searchLimit : 50);
		return options.length > 0 ? [{ title: category.title, options }] : [];
	});
}
