import { describe, expect, test } from "bun:test";
import type { InboxPullRequest } from "../src/shared/github";
import type { CompletionItem, PastSession, RosterHost } from "../src/shared/sessions";
import type { Ticket } from "../src/shared/tickets";
import type { ChangedFile, FileChange } from "../src/shared/transcript";
import type { UserTodo, UserTodoLeaf } from "../src/user-todos-shared";
import { fileSearch, type MentionData, mentionMenu, mentionQuery, type MenuSection } from "./mentions";

const leaf = (id: string, text: string, doneAt: string | null = null): UserTodoLeaf => ({ id, text, body: "", doneAt, due: null });
const todo = (id: string, text: string, fields: Partial<UserTodo> = {}): UserTodo => ({
	...leaf(id, text),
	categoryId: null,
	children: [],
	links: [],
	addedBy: null,
	...fields,
});
const host = (sessionId: string, sessionName: string | null) => ({ sessionId, sessionName, cwdDisplay: "~/code/webapp" }) as RosterHost;

const data: MentionData = {
	todos: [
		todo("t1", "Fix login redirect", { children: [leaf("t1a", "Write the login test"), leaf("t1b", "Ship login fix", "2026-10-01T09:00:00.000Z")] }),
		todo("t2", "Clean up login logs", { doneAt: "2026-10-02T09:00:00.000Z" }),
		todo("t3", 'Ask about "SSO" login'),
		todo("t4", "Login page copy"),
	],
	tickets: [{ id: "ENG-12", title: "Login [beta] flag", url: "https://linear.app/acme/issue/ENG-12" } as Ticket],
	inbox: [
		{ owner: "acme", repo: "webapp", cwds: ["/code/webapp"], pullRequests: [{ owner: "acme", repo: "webapp", number: 7, title: "Fix login" } as InboxPullRequest] },
		{ owner: "acme", repo: "api", cwds: ["/code/api"], error: "GitHub is down" },
	],
	hosts: [host("s-self", "Login work"), host("s-live", null)],
	past: [{ sessionId: "s-old", title: "Login bug hunt", cwdDisplay: "~/code/api" } as PastSession],
	sessionId: "s-self",
};

const fileItem = (path: string): CompletionItem => ({ kind: "file", label: path, description: null, text: `@${path} `, cursor: path.length + 2 });
const labels = (sections: MenuSection[]) => sections.map(({ title, options }) => [title, options.map(option => option.label)]);
const menu = (text: string, { files = null, changed = [], cursor = text.length }: { files?: CompletionItem[] | null; changed?: ChangedFile[]; cursor?: number } = {}) =>
	mentionMenu({ text, cursor, data, changed, files });
const pick = (text: string, label: string, cursor = text.length) =>
	menu(text, { cursor }).flatMap(section => section.options).find(option => option.label === label)?.edit;

describe("mentionQuery", () => {
	test("@ alone is home, a word searches, and a known prefix narrows to its source", () => {
		const at = (text: string) => mentionQuery(text, text.length);
		expect(at("Read @")).toEqual({ kind: "home" });
		expect(at("Read @login")).toEqual({ kind: "search", words: "login" });
		expect(at("@file:src/")).toEqual({ kind: "source", source: "file", words: "src/" });
		expect(at("@todo:")).toEqual({ kind: "source", source: "todo", words: "" });
		expect(at("@ticket:login")).toEqual({ kind: "source", source: "ticket", words: "login" });
		expect(at("@pr:7")).toEqual({ kind: "source", source: "pull-request", words: "7" });
		expect(at("@session:bug")).toEqual({ kind: "source", source: "session", words: "bug" });
		expect(at('@ticket:"login page')).toEqual({ kind: "source", source: "ticket", words: "login page" });
		expect(at('@"login page')).toEqual({ kind: "search", words: "login page" });
	});

	test("an unknown prefix is a search, and an @ inside a word is no mention", () => {
		expect(mentionQuery("@wiki:login", 11)).toEqual({ kind: "search", words: "wiki:login" });
		expect(mentionQuery("Write me@example.com", 20)).toBeNull();
		expect(mentionQuery("Write @me now", 13)).toBeNull();
	});
});

describe("fileSearch", () => {
	test("asks omp for @words in place of @file:words, and as typed for a search", () => {
		expect(fileSearch("See @file:src now", 13)).toEqual({ text: "See @src now", cursor: 8 });
		expect(fileSearch('@file:"my notes', 15)).toEqual({ text: '@"my notes', cursor: 10 });
		expect(fileSearch("See @login", 10)).toEqual({ text: "See @login", cursor: 10 });
	});

	test("asks nothing on home or another source", () => {
		expect(fileSearch("See @", 5)).toBeNull();
		expect(fileSearch("See @ticket:login", 17)).toBeNull();
		expect(fileSearch("See @file:", 10)).toEqual({ text: "See @", cursor: 5 });
	});
});

describe("mentionMenu", () => {
	const change = (at: number | null, kind: "edited" | "deleted" = "edited"): FileChange => ({ tool: "edit", kind, at, added: 1, removed: 0, diff: null });
	const changed: ChangedFile[] = [
		{ path: "src/a.ts", changes: [change(1)] },
		{ path: "src/b.ts", changes: [change(1), change(30)] },
		{ path: "~/notes/outside.md", changes: [change(40)] },
		{ path: "gone.ts", changes: [change(50, "deleted")] },
		{ path: "my notes.md", changes: [change(20)] },
		{ path: "src/c.ts", changes: [change(10)] },
	];
	const categories = ["Files & Folders", "Todos", "Tickets", "Pull requests", "Sessions"];

	test("home offers the last three files the agent changed inside its directory, then every category", () => {
		expect(labels(menu("Read @", { changed }))).toEqual([
			[null, ["src/b.ts", "my notes.md", "src/c.ts"]],
			[null, categories],
		]);
		expect(labels(menu("Read @"))).toEqual([[null, categories]]);
		const recent = menu("Read @", { changed })[0].options;
		expect(recent.map(option => option.edit)).toEqual([
			{ text: "Read @src/b.ts ", cursor: 15 },
			{ text: 'Read @"my notes.md" ', cursor: 20 },
			{ text: "Read @src/c.ts ", cursor: 15 },
		]);
	});

	test("a category rewrites the token to its prefix and keeps the menu open", () => {
		const home = menu("Ask @")[0].options;
		expect(home.map(option => [option.edit.text, option.opens])).toEqual([
			["Ask @file:", true],
			["Ask @todo:", true],
			["Ask @ticket:", true],
			["Ask @pr:", true],
			["Ask @session:", true],
		]);
		expect(home[2].edit.cursor).toBe(12);
	});

	test("a search lists five files, then three matches per source, leaving out done todos and this session", () => {
		const files = ["a", "b", "c", "d", "e", "f"].map(name => fileItem(`src/login-${name}.ts`));
		expect(labels(menu("@login", { files }))).toEqual([
			["Files & Folders", ["src/login-a.ts", "src/login-b.ts", "src/login-c.ts", "src/login-d.ts", "src/login-e.ts"]],
			["Todos", ["Fix login redirect", "Write the login test", 'Ask about "SSO" login']],
			["Tickets", ["Login [beta] flag"]],
			["Pull requests", ["Fix login"]],
			["Sessions", ["Login bug hunt"]],
		]);
		expect(labels(menu("@login"))).toEqual([
			["Todos", ["Fix login redirect", "Write the login test", 'Ask about "SSO" login']],
			["Tickets", ["Login [beta] flag"]],
			["Pull requests", ["Fix login"]],
			["Sessions", ["Login bug hunt"]],
		]);
	});

	test("every word must match the label, key, or detail, in any order and any case", () => {
		expect(labels(menu('@"LOGIN fix'))).toEqual([
			// A subtodo's detail is its parent's title, so it matches words from either.
			["Todos", ["Fix login redirect", "Write the login test"]],
			["Pull requests", ["Fix login"]],
		]);
		expect(labels(menu('@todo:"test redirect'))).toEqual([["Todos", ["Write the login test"]]]);
		expect(labels(menu("@ticket:eng-12"))).toEqual([["Tickets", ["Login [beta] flag"]]]);
		expect(labels(menu("@wiki:login"))).toEqual([]);
	});

	test("a prefix shows only its source, up to fifty", () => {
		expect(labels(menu("@todo:"))).toEqual([["Todos", ["Fix login redirect", "Write the login test", 'Ask about "SSO" login', "Login page copy"]]]);
		expect(labels(menu("@file:src", { files: [fileItem("src/")] }))).toEqual([["Files & Folders", ["src/"]]]);
		const many = mentionMenu({
			text: "@todo:",
			cursor: 6,
			data: { ...data, todos: Array.from({ length: 60 }, (_, index) => todo(`t${index}`, `Todo ${index}`)) },
			changed: [],
			files: null,
		});
		expect(many[0].options).toHaveLength(50);
	});

	test("an item replaces the whole token with its reference and a space, the caret after it", () => {
		expect(pick("Look at @todo:sso", 'Ask about "SSO" login')).toEqual({ text: 'Look at todo "Ask about \\"SSO\\" login" (id t3) ', cursor: 47 });
		expect(pick("@ticket:login", "Login [beta] flag")).toEqual({
			text: "[ENG-12 Login \\[beta\\] flag](https://linear.app/acme/issue/ENG-12) ",
			cursor: 67,
		});
		expect(pick("@pr:fix then merge", "Fix login", 7)).toEqual({ text: "[acme/webapp#7 Fix login](https://github.com/acme/webapp/pull/7)  then merge", cursor: 65 });
		expect(pick("@session:", "webapp")).toEqual({ text: 'omp session "webapp" (id s-live) ', cursor: 33 });
		expect(pick("@session:", "Login bug hunt")).toEqual({ text: 'omp session "Login bug hunt" (id s-old) ', cursor: 40 });
	});
});
