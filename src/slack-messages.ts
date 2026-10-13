/**
 * The Slack messages that wait on you, for the bell: mentions of you in channels, and the direct and group messages
 * someone sent since you last wrote in that conversation. It reads Slack's search API with the token omp holds for its
 * Slack MCP server, which answers in JSON where the server's search tool answers in Markdown.
 */
import { isObject, nonEmptyStr, str } from "./json";
import type { SlackSubject } from "./shared/notices";
import type { SignedFetch } from "./signed-fetch";

const API = "https://slack.com/api";

/** How far back the bell looks. */
const WINDOW_MS = 3 * 24 * 60 * 60_000;

/** How many pages of 20 messages, Slack's most, one search reads; a busy window's oldest messages fall past them. */
const MAX_PAGES = 5;

/** A Slack message the bell lists, keyed by its conversation and timestamp. */
export type SlackFound = { id: string; at: number } & SlackSubject;

interface Message {
	author: string;
	authorId: string;
	bot: boolean;
	channelId: string;
	channelName: string;
	ts: string;
	text: string;
	permalink: string;
}

function messageOf(item: unknown): Message | null {
	if (!isObject(item)) return null;
	const channelId = nonEmptyStr(item.channel_id);
	const ts = nonEmptyStr(item.message_ts);
	const permalink = nonEmptyStr(item.permalink);
	if (!channelId || !ts || !permalink) return null;
	return {
		author: str(item.author_name) ?? "",
		authorId: str(item.author_user_id) ?? "",
		bot: item.is_author_bot === true,
		channelId,
		channelName: str(item.channel_name) ?? "",
		ts,
		text: str(item.content) ?? "",
		permalink,
	};
}

/** The messages of a search answer, newest first, and the cursor of the next page; throws Slack's error when it answered one. */
function pageOf(answer: unknown): { messages: Message[]; next: string | undefined } {
	if (!isObject(answer) || answer.ok !== true) throw new Error(`Slack's search failed: ${(isObject(answer) && str(answer.error)) || "no answer"}`);
	const results = isObject(answer.results) && Array.isArray(answer.results.messages) ? answer.results.messages : [];
	return { messages: results.flatMap(item => messageOf(item) ?? []), next: isObject(answer.response_metadata) ? nonEmptyStr(answer.response_metadata.next_cursor) : undefined };
}

/** Slack's markup as plain text: `<@U1|Ana>` as `@Ana`, `<#C1|general>` as `#general`, a link as its label, and its escapes undone. */
function slackText(markup: string): string {
	return markup
		.replace(/<([^<>]*)>/g, (_, inner: string) => {
			const [target = "", label] = inner.split("|");
			if (target.startsWith("@")) return `@${label ?? "someone"}`;
			if (target.startsWith("#")) return `#${label ?? "channel"}`;
			if (target.startsWith("!")) return label ?? `@${target.slice(1).split("^")[0]}`;
			return label ?? target;
		})
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&")
		.replace(/\s+/g, " ")
		.trim();
}

/** Someone's message, with words in it: not yours, not a bot's, and not one Slack wrote, such as `created this channel`. */
const fromSomeone = (message: Message, me: string): boolean => message.authorId !== me && !message.bot && message.author !== "" && message.authorId !== "U00" && slackText(message.text) !== "";

/**
 * The notices for `dms`, the newest direct and group messages, and `mentions`, the newest messages that mention `me`,
 * both newest first. A conversation gives one notice for the messages since `me` last wrote there; a mention gives one.
 * `avatars` holds each author's profile picture by user ID.
 */
function slackNotices(dms: Message[], mentions: Message[], me: string, avatars: ReadonlyMap<string, string>): SlackFound[] {
	const waiting = [...Map.groupBy(dms, message => message.channelId).values()].flatMap(messages => {
		const answered = messages.findIndex(message => message.authorId === me);
		const unanswered = (answered === -1 ? messages : messages.slice(0, answered)).filter(message => fromSomeone(message, me));
		const [newest] = unanswered;
		if (!newest) return [];
		const type = newest.channelName.startsWith("mpdm-") ? "group-dm" : "dm";
		return [{ id: `slack:${newest.channelId}:${newest.ts}`, at: Number(newest.ts) * 1000, kind: "slack", type, count: unanswered.length, from: newest.author, avatarUrl: avatars.get(newest.authorId) ?? null, text: slackText(newest.text), permalink: newest.permalink } as const];
	});
	const mentioned = mentions
		.filter(message => fromSomeone(message, me))
		.map(message => ({ id: `slack:${message.channelId}:${message.ts}`, at: Number(message.ts) * 1000, kind: "slack", type: "mention", channel: message.channelName, from: message.author, avatarUrl: avatars.get(message.authorId) ?? null, text: slackText(message.text), permalink: message.permalink }) as const);
	return [...waiting, ...mentioned];
}

/** Slack's answer to one search for `query` in `channelTypes` since `after`, newest first and without bots, up to {@link MAX_PAGES} pages. */
async function search(get: SignedFetch, query: string, channelTypes: string, after: number): Promise<Message[]> {
	const params = new URLSearchParams({ query, channel_types: channelTypes, sort: "timestamp", include_bots: "false", limit: "20", after: String(Math.floor(after / 1000)) });
	const messages: Message[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const { messages: found, next } = pageOf(await get(`${API}/assistant.search.context?${params}`));
		messages.push(...found);
		if (!next) break;
		params.set("cursor", next);
	}
	return messages;
}

/** Who the token signs in as. */
async function signedInAs(get: SignedFetch): Promise<string> {
	const answer = await get(`${API}/auth.test`);
	const id = isObject(answer) && answer.ok === true ? nonEmptyStr(answer.user_id) : undefined;
	if (!id) throw new Error(`Slack did not say who you are: ${(isObject(answer) && str(answer.error)) || "no answer"}`);
	return id;
}

/**
 * The 72-pixel profile picture of each of `users` that Slack's `users.info` gives. One it refuses, such as under a
 * sign-in without `users:read`, has none, so the bell shows that author's initial.
 */
async function avatarsOf(get: SignedFetch, users: Iterable<string>): Promise<Map<string, string>> {
	const found = await Promise.all(
		[...new Set(users)].map(async user => {
			const answer = await get(`${API}/users.info?${new URLSearchParams({ user })}`).catch(() => null);
			const url = isObject(answer) && answer.ok === true && isObject(answer.user) && isObject(answer.user.profile) ? nonEmptyStr(answer.user.profile.image_72) : undefined;
			return url ? [[user, url] as const] : [];
		}),
	);
	return new Map(found.flat());
}

/** The Slack messages of the last {@link WINDOW_MS} that wait on you, as of `now`. */
export async function waitingOnYou(get: SignedFetch, now: number): Promise<SlackFound[]> {
	const me = await signedInAs(get);
	const after = now - WINDOW_MS;
	const [dms, mentions] = await Promise.all([search(get, "*", "im,mpim", after), search(get, `<@${me}>`, "public_channel,private_channel", after)]);
	const avatars = await avatarsOf(get, [...dms, ...mentions].filter(message => fromSomeone(message, me)).map(message => message.authorId));
	return slackNotices(dms, mentions, me, avatars);
}
