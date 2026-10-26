/** How the bell words, pictures, links, acts on, and toasts each notice: {@link presentNotice}, the one place that tells notice kinds apart. */
import type { PullRequestSummary } from "../src/shared/github";
import type { YourMove } from "../src/shared/moves";
import { type Notice, type UpdateSubject, usesClause } from "../src/shared/notices";
import { folderName, providerLabel } from "./labels";
import { moveAction } from "./pull-requests-model";
import type { PullRequestActionId } from "../src/pull-request-actions";
import { hashForCalendar, hashForPullRequests, hashForSettings } from "./routing";

/** The bell's filters, each a source of notices. */
export type NoticeSource = "github" | "slack" | "providers" | "calendar" | "sessions" | "updates";

/** Where a notice leads: a dashboard hash, or a page outside the dashboard that opens in a new tab. */
export type NoticeLink = { href: string; external: boolean };

/** Who a notice's picture shows. */
export type NoticeFace =
	| { kind: "update" }
	| { kind: "event"; color: string | null }
	| { kind: "stopped" }
	| { kind: "provider"; provider: string; window: "plan" | "credits" }
	| { kind: "move"; move: YourMove; person: { name: string; avatarUrl: string | null } | null }
	| { kind: "slack"; person: { name: string; avatarUrl: string | null } };

/**
 * A notice's button: **Update** (`ready` when it may run: before the update, and again after it failed), **Merge**,
 * which merges after a confirmation, the quick action that makes a pull request's move, or **Continue all**, which
 * resumes `sessionIds` and sends `continue` to each.
 */
export type NoticeAction =
	| { kind: "none" }
	| { kind: "update"; label: "Update" | "Updating"; ready: boolean }
	| { kind: "merge"; pr: PullRequestSummary }
	| { kind: "quick"; pr: PullRequestSummary; action: PullRequestActionId; cwd: string }
	| { kind: "continue-all"; sessionIds: string[] };

/**
 * How a notice toasts. News toasts once while fresh and opens its link, or acts as **Continue all**, staying `timeout` ms
 * (`0` until dismissed). An update toasts until dismissed and follows its status; `dismissedElsewhere` closes it once
 * another tab saw it before it ran.
 */
export type NoticeToast = { kind: "news"; timeout: number } | { kind: "update"; dismissedElsewhere: boolean };

export interface NoticePresentation {
	source: NoticeSource;
	/** What it says in one line, as its toast's title and its row's headline. */
	headline: string;
	/** What it says after its headline. */
	preview: string;
	/** Whether its preview is an error. */
	failed: boolean;
	/** Whether it is mid-update, so it cannot be cleared. */
	busy: boolean;
	link: NoticeLink | null;
	face: NoticeFace;
	action: NoticeAction;
	toast: NoticeToast;
}

/** How long a news toast stays; an event's stays until dismissed or the event ends. */
export const TOAST_MS = 6_000;

/** Each of your moves as the bell words it. */
export const MOVE_HEADLINE: Record<YourMove, string> = {
	review: "Review requested",
	merge: "Ready to merge",
	"fix-ci": "Checks failed",
	rebase: "Conflicts to resolve",
	reply: "Comments to address",
};

const SAME_DAY = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const OTHER_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const timeLabel = (at: number, now: number): string => (new Date(at).toDateString() === new Date(now).toDateString() ? SAME_DAY : OTHER_DAY).format(at);

const creditsClause = (count: number): string => (count === 1 ? "The plan holds 1 reset credit." : `The plan holds ${count} reset credits.`);
/** What a news notice shares: no error, no update running, no button, and a toast that closes itself. */
const NEWS = { failed: false, busy: false, action: { kind: "none" }, toast: { kind: "news", timeout: TOAST_MS } } as const satisfies Partial<NoticePresentation>;

/** Who made a pull request your move: the author who asked for your review, the reviewer who asked for changes or commented, or the one who approved. */
function actorOf({ pr, move }: Extract<Notice, { kind: "pull-request" }>) {
	if (move === "review") return pr.author;
	if (move === "reply") return pr.reviewers.find(({ state }) => state === "changes-requested") ?? pr.reviewers.find(({ state }) => state === "commented") ?? null;
	if (move === "merge") return pr.reviewers.find(({ state }) => state === "approved") ?? null;
	return null;
}

/** Everything the bell and the toasts show and do for `notice`, as of `now`. */
export function presentNotice(notice: Notice, now: number): NoticePresentation {
	switch (notice.kind) {
		case "pull-request": {
			const { pr, move, cwd } = notice;
			const actor = actorOf(notice);
			const action = move === "merge" ? null : moveAction(pr, move);
			return {
				...NEWS,
				source: "github",
				headline: `${MOVE_HEADLINE[move]} · ${pr.repo}#${pr.number}`,
				preview: pr.title,
				link: { href: hashForPullRequests(pr), external: false },
				face: { kind: "move", move, person: actor && { name: actor.login, avatarUrl: actor.avatarUrl } },
				action: move === "merge" ? { kind: "merge", pr } : action ? { kind: "quick", pr, action, cwd } : { kind: "none" },
			};
		}
		case "slack":
			return {
				...NEWS,
				source: "slack",
				headline:
					notice.type === "mention"
						? `${notice.from} mentioned you in #${notice.channel}`
						: notice.type === "group-dm"
							? `${notice.from} wrote in a group message`
							: notice.count === 1
								? `${notice.from} sent you a message`
								: `${notice.from} sent you ${notice.count} messages`,
				preview: notice.text,
				link: { href: notice.permalink, external: true },
				face: { kind: "slack", person: { name: notice.from, avatarUrl: notice.avatarUrl } },
			};
		case "plan": {
			const said = [notice.resetsAt === null ? "" : `Resets ${timeLabel(notice.resetsAt, now)}.`, notice.resetCredits > 0 ? creditsClause(notice.resetCredits) : ""].filter(Boolean).join(" ");
			return {
				...NEWS,
				source: "providers",
				headline: `${notice.name} ${notice.windowTitle} is used up`,
				preview: [notice.account, said].filter(Boolean).join(": "),
				link: { href: hashForSettings("providers"), external: false },
				face: { kind: "provider", provider: notice.provider, window: "plan" },
			};
		}
		case "credits":
			return {
				...NEWS,
				source: "providers",
				headline: `${providerLabel(notice.provider)} is out of credits`,
				preview: `${notice.failures === 1 ? "A request" : `${notice.failures} requests`} to ${notice.model} failed since ${timeLabel(notice.since, now)}: ${notice.error}`,
				link: { href: hashForSettings("providers"), external: false },
				face: { kind: "provider", provider: notice.provider, window: "credits" },
			};
		case "event":
			return {
				...NEWS,
				source: "calendar",
				headline: `${notice.title} ${notice.start > now ? "starts" : "started"} at ${SAME_DAY.format(notice.start)}`,
				preview: `${SAME_DAY.format(notice.start)} – ${SAME_DAY.format(notice.end)} · ${notice.calendar ?? "This computer"}`,
				link: notice.url === null ? { href: hashForCalendar(), external: false } : { href: notice.url, external: true },
				face: { kind: "event", color: notice.color },
				toast: { kind: "news", timeout: 0 },
			};
		case "stopped": {
			const count = notice.sessions.length;
			return {
				...NEWS,
				source: "sessions",
				headline: count === 1 ? "1 session stopped mid-turn" : `${count} sessions stopped mid-turn`,
				// Named as the sidebar names a past session.
				preview: notice.sessions.map(({ title, cwdDisplay }) => title ?? (cwdDisplay === null ? undefined : folderName(cwdDisplay)) ?? "Untitled session").join(" · "),
				link: null,
				face: { kind: "stopped" },
				action: { kind: "continue-all", sessionIds: notice.sessions.map(({ sessionId }) => sessionId) },
				// It comes at the server's start, which you may not watch.
				toast: { kind: "news", timeout: 0 },
			};
		}
		case "omp":
		case "model":
		case "dashboard": {
			const { status } = notice;
			const words = updateWords(notice);
			let preview: string;
			switch (status.state) {
				case "available":
					preview = words.available;
					break;
				case "updating":
					preview = words.updating;
					break;
				case "updated":
					preview = status.note;
					break;
				case "failed":
					preview = status.error;
					break;
			}
			return {
				source: "updates",
				headline: words.headline,
				preview,
				failed: status.state === "failed",
				busy: status.state === "updating",
				link: null,
				face: { kind: "update" },
				action:
					status.state === "updated"
						? { kind: "none" }
						: { kind: "update", label: status.state === "updating" ? "Updating" : "Update", ready: status.state === "available" || status.state === "failed" },
				toast: { kind: "update", dismissedElsewhere: notice.seen && status.state === "available" },
			};
		}
	}
}

/** How an update notice words itself, before and while its update runs. */
function updateWords(notice: UpdateSubject): { headline: string; available: string; updating: string } {
	switch (notice.kind) {
		case "omp":
			return { headline: `omp ${notice.latest} is out`, available: `You run omp ${notice.current}.`, updating: "Updating omp…" };
		case "model":
			return { headline: `${notice.to.name} is out`, available: `${usesClause(notice.uses)} ${notice.from.name}.`, updating: `Switching to ${notice.to.name}…` };
		case "dashboard":
			return {
				headline: `omp-agents update: ${notice.commits === 1 ? "1 new commit" : `${notice.commits} new commits`} on ${notice.branch}`,
				available: "Update pulls them and restarts omp-agents.",
				updating: "Pulling and restarting omp-agents…",
			};
		default: {
			const unhandled: never = notice;
			return unhandled;
		}
	}
}

/** Opens a notice's link: in a new tab when it leads outside the dashboard, else in the dashboard. */
export function follow(link: NoticeLink | null): void {
	if (link === null) return;
	if (link.external) window.open(link.href, "_blank", "noopener,noreferrer");
	else location.hash = link.href;
}
