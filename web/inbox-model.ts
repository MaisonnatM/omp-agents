/** The Inbox's items: everything that waits on you, from the live sessions and the pull request, Slack, and stopped-session notices, in the order you work them. */
import type { Notice } from "../src/shared/notices";
import type { RosterHost, UnreadTurn, UserRequest } from "../src/shared/sessions";

/** A notice the Inbox lists: your pull request moves, Slack messages, and sessions that stopped mid-turn. */
export type InboxNotice = Extract<Notice, { kind: "pull-request" | "slack" | "stopped" }>;

/**
 * One thing that waits on you. `key` names it across roster pushes, so the open item stays open; `at` is when it
 * began to wait, `null` for a question, whose start the roster does not carry. An `ask` with a `null` request is a
 * wait whose question the session has not relayed.
 */
export type InboxItem =
	| { kind: "ask"; key: string; at: null; host: RosterHost; request: UserRequest | null }
	| { kind: "turn"; key: string; at: number; host: RosterHost; turn: UnreadTurn }
	| { kind: "notice"; key: string; at: number; notice: InboxNotice };

export const INBOX_GROUPS = ["Agents asking", "Agents finished", "Pull requests", "Messages", "Stopped"] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];

const NOTICE_GROUP: Record<InboxNotice["kind"], InboxGroup> = { "pull-request": "Pull requests", slack: "Messages", stopped: "Stopped" };

export function groupOf(item: InboxItem): InboxGroup {
	if (item.kind === "ask") return "Agents asking";
	if (item.kind === "turn") return "Agents finished";
	return NOTICE_GROUP[item.notice.kind];
}

/** The Inbox's filter chips: every item, the sessions', the pull requests', or the messages'. */
export const INBOX_FILTERS = [
	{ id: "all", label: "All", groups: INBOX_GROUPS },
	{ id: "agents", label: "Agents", groups: ["Agents asking", "Agents finished", "Stopped"] },
	{ id: "pull-requests", label: "Pull requests", groups: ["Pull requests"] },
	{ id: "messages", label: "Messages", groups: ["Messages"] },
] as const satisfies readonly { id: string; label: string; groups: readonly InboxGroup[] }[];
export type InboxFilter = (typeof INBOX_FILTERS)[number]["id"];

const isInboxNotice = (notice: Notice): notice is InboxNotice => notice.kind === "pull-request" || notice.kind === "slack" || notice.kind === "stopped";

/**
 * The items, grouped as {@link INBOX_GROUPS} lists them, the longest wait first in each group, and questions in the
 * roster's order. A session that asks shows its oldest question, not also its unread turn; a cleared notice is gone.
 */
export function inboxItems(hosts: readonly RosterHost[], notices: readonly Notice[]): InboxItem[] {
	const items: InboxItem[] = [];
	for (const host of hosts) {
		const [request] = host.requests;
		if (request || host.status === "needs-input") items.push({ kind: "ask", key: `ask/${host.instanceId}/${request?.id ?? "input"}`, at: null, host, request: request ?? null });
		else if (host.unread) items.push({ kind: "turn", key: `turn/${host.instanceId}/${host.unread.at}`, at: host.unread.at, host, turn: host.unread });
	}
	for (const notice of notices) if (isInboxNotice(notice)) items.push({ kind: "notice", key: `notice/${notice.id}`, at: notice.at, notice });
	const rank = (item: InboxItem): number => INBOX_GROUPS.indexOf(groupOf(item));
	return items.sort((a, b) => rank(a) - rank(b) || (a.at ?? 0) - (b.at ?? 0));
}

/** The item to open once item `key`, at `index` before, may have left `items`: itself while it stays, else the one now at its place, else the last. */
export function nextAfter(items: readonly InboxItem[], key: string, index: number): InboxItem | null {
	return items.find(item => item.key === key) ?? items[Math.min(index, items.length - 1)] ?? null;
}
