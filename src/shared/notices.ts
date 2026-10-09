/**
 * What the bell lists: a newer omp or routed model, a pull request whose next move is yours, and a Slack message that
 * waits on you.
 */
import type { InboxPullRequest } from "./github";
import type { YourMove } from "./moves";

export interface NamedModel {
	id: string;
	/** omp's name for it, such as `Claude Opus 5.6`. */
	name: string;
}

/** A model the routing names, `from`, and its newest version on the same provider, `to`. */
export interface ModelUpdate {
	provider: string;
	from: NamedModel;
	to: NamedModel;
	/** Where the routing names `from`: a role, such as `default`, or a fallback chain, as `smol fallbacks`. */
	uses: string[];
}

const USES = new Intl.ListFormat("en", { type: "conjunction" });

/** `uses` as a sentence's subject and verb: `plan and default fallbacks use`, `smol uses`. */
export const usesClause = (uses: string[]): string => `${USES.format(uses)} ${uses.length === 1 ? "uses" : "use"}`;

export type NoticeStatus =
	| { state: "available" }
	| { state: "updating" }
	| { state: "updated"; note: string }
	| { state: "failed"; error: string };

/** An omp release newer than the one installed, or a newer version of a routed model. */
export type UpdateSubject = { kind: "omp"; current: string; latest: string } | ({ kind: "model" } & ModelUpdate);

/** A pull request of a project whose next move is yours, with the project directory a quick action on it starts in. */
export interface PullRequestSubject {
	kind: "pull-request";
	pr: InboxPullRequest;
	move: YourMove;
	cwd: string;
}

/**
 * A Slack message that waits on you: a mention of you in a channel, or the messages someone sent in a direct or group
 * message since you last wrote there, of which it holds the newest.
 */
export type SlackSubject = { kind: "slack"; from: string; text: string; permalink: string } & (
	| { type: "mention"; channel: string }
	| { type: "dm" | "group-dm"; count: number }
);

export type NoticeSubject = UpdateSubject | PullRequestSubject | SlackSubject;

export type NoticeKind = NoticeSubject["kind"];

/**
 * One notice. The id names what it is about in the state that made it, such as the versions of an update or a pull
 * request's move, so a new state is a new notice even after the last one was cleared. `at` is when the news came, in
 * ms since the epoch. `seen` is set once its toast showed or the user started its update, so it toasts once; `read`
 * once the user opened it or marked it read, which takes it out of the bell's unread count.
 */
export type Notice = { id: string; at: number; seen: boolean; read: boolean } & ((UpdateSubject & { status: NoticeStatus }) | PullRequestSubject | SlackSubject);

/** `update` installs the release or rewrites the routing; `seen` stops its toast; `read` takes it out of the unread count; `clear` hides it until its state changes. */
export const NOTICE_OPS = ["update", "seen", "read", "clear"] as const;
export type NoticeOp = (typeof NOTICE_OPS)[number];
