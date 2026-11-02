/** The Inbox's items: everything that waits on you, from the live sessions and the pull request, Slack, and stopped-session notices, in the order you work them. */
import type { Notice } from "../src/shared/notices";
import type { RosterHost, UnreadTurn, UserRequest } from "../src/shared/sessions";
import { FINISHED_TURN, WAITS_FOR_INPUT, waitOf } from "./attention";
import { folderName, hostLabel } from "./labels";
import { type NoticePresentation, presentNotice } from "./notice-model";

/** A notice the Inbox lists: your pull request moves, Slack messages, and sessions that stopped mid-turn. */
export type InboxNotice = Extract<Notice, { kind: "pull-request" | "slack" | "stopped" }>;

export const INBOX_GROUPS = ["Agents asking", "Agents finished", "Pull requests", "Messages", "Stopped"] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];

/**
 * What every item's row and detail say: the group it lists under, its title, the place it belongs to, such as its
 * session's folder or its pull request's repository, `null` for none, and its second line.
 */
interface InboxText {
	group: InboxGroup;
	title: string;
	place: string | null;
	line: string;
}

/**
 * One thing that waits on you. `key` names it across roster pushes, so the open item stays open; `at` is when it
 * began to wait, `null` for a question, whose start the roster does not carry. An `ask` with a `null` request is a
 * wait whose question the session has not relayed.
 */
export type InboxItem = InboxText &
	(
		| { kind: "ask"; key: string; at: null; host: RosterHost; request: UserRequest | null }
		| { kind: "turn"; key: string; at: number; host: RosterHost; turn: UnreadTurn }
		| { kind: "notice"; key: string; at: number; notice: InboxNotice; presentation: NoticePresentation }
	);

/** One group of items, as the list heads it. */
export interface InboxSection {
	group: InboxGroup;
	items: InboxItem[];
}

/** The Inbox's filter chips: every item, the sessions', the pull requests', or the messages'. */
export const INBOX_FILTERS = [
	{ id: "all", label: "All" },
	{ id: "agents", label: "Agents" },
	{ id: "pull-requests", label: "Pull requests" },
	{ id: "messages", label: "Messages" },
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number]["id"];

const FILTER_GROUPS: Record<InboxFilter, readonly InboxGroup[]> = {
	all: INBOX_GROUPS,
	agents: ["Agents asking", "Agents finished", "Stopped"],
	"pull-requests": ["Pull requests"],
	messages: ["Messages"],
};

const NOTICE_GROUP: Record<InboxNotice["kind"], InboxGroup> = { "pull-request": "Pull requests", slack: "Messages", stopped: "Stopped" };

const isInboxNotice = (notice: Notice): notice is InboxNotice => notice.kind === "pull-request" || notice.kind === "slack" || notice.kind === "stopped";

/** The item live session `host` makes, `null` while it does not wait on you. */
function hostItem(host: RosterHost): InboxItem | null {
	const wait = waitOf(host);
	if (!wait) return null;
	const title = hostLabel(host);
	const place = folderName(host.cwdDisplay) ?? null;
	switch (wait.kind) {
		case "ask":
			return { kind: "ask", key: `ask/${host.instanceId}/${wait.request.id}`, at: null, host, request: wait.request, group: "Agents asking", title, place, line: wait.request.title };
		case "input":
			return { kind: "ask", key: `ask/${host.instanceId}/input`, at: null, host, request: null, group: "Agents asking", title, place, line: WAITS_FOR_INPUT };
		case "turn": {
			const { turn } = wait;
			const [first] = turn.suggestions;
			const line = first ? `↳ ${first}` : (turn.reply ?? FINISHED_TURN);
			return { kind: "turn", key: `turn/${host.instanceId}/${turn.at}`, at: turn.at, host, turn, group: "Agents finished", title, place, line };
		}
		default: {
			const unhandled: never = wait;
			return unhandled;
		}
	}
}

/** The item notice `notice` makes, as of `now`. */
function noticeItem(notice: InboxNotice, now: number): InboxItem {
	const presentation = presentNotice(notice, now);
	const place = notice.kind === "pull-request" ? notice.pr.repo : notice.kind === "slack" ? (notice.type === "mention" ? `#${notice.channel}` : "Slack") : null;
	return { kind: "notice", key: `notice/${notice.id}`, at: notice.at, notice, presentation, group: NOTICE_GROUP[notice.kind], title: presentation.headline, place, line: presentation.preview };
}

/**
 * The groups that hold items, in {@link INBOX_GROUPS} order, as of `now`: questions in the roster's order, and every
 * other group the longest wait first. A session that asks shows its oldest question, not also its unread turn; a
 * cleared notice is gone.
 */
export function inboxSections(hosts: readonly RosterHost[], notices: readonly Notice[], now: number): InboxSection[] {
	const items = [...hosts.flatMap(host => hostItem(host) ?? []), ...notices.filter(isInboxNotice).map(notice => noticeItem(notice, now))];
	const questions = items.filter(item => item.at === null);
	const waits = items.filter((item): item is Extract<InboxItem, { at: number }> => item.at !== null).toSorted((a, b) => a.at - b.at);
	const byGroup = Map.groupBy([...questions, ...waits], item => item.group);
	return INBOX_GROUPS.flatMap(group => {
		const listed = byGroup.get(group);
		return listed ? [{ group, items: listed }] : [];
	});
}

/** The sections filter `filter` shows. */
export const sectionsIn = (sections: readonly InboxSection[], filter: InboxFilter): InboxSection[] => sections.filter(({ group }) => FILTER_GROUPS[filter].includes(group));

/** How many items `sections` hold. */
export const itemCount = (sections: readonly InboxSection[]): number => sections.reduce((count, { items }) => count + items.length, 0);

/** The item to open once item `key`, at `index` before, may have left `items`: itself while it stays, else the one now at its place, else the last. */
export function nextAfter(items: readonly InboxItem[], key: string, index: number): InboxItem | null {
	return items.find(item => item.key === key) ?? items[Math.min(index, items.length - 1)] ?? null;
}
