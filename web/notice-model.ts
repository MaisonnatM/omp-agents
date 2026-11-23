/** How the bell words, pictures, links, acts on, and toasts each notice: {@link presentNotice}, the one place that tells notice kinds apart. */
import { didNotStart, shortCommit } from "../src/shared/dashboard-update";
import type { PullRequestSummary } from "../src/shared/github";
import type { YourMove } from "../src/shared/moves";
import { type Notice, type UpdateSubject, usesClause } from "../src/shared/notices";
import { hashForSession } from "../src/shared/sessions";
import { folderName, providerLabel } from "./labels";
import { moveAction } from "./pull-requests-model";
import type { PullRequestActionId } from "../src/pull-request-actions";
import { hashForBotRoutine, hashForPullRequests, hashForSettings } from "./routing";
import type { EarlyExit } from "../src/routine-health";

/** The bell's filters, each a source of notices. */
export type NoticeSource = "github" | "slack" | "providers" | "sessions" | "routines" | "updates";

/** Where a notice leads: a dashboard hash, or a page outside the dashboard that opens in a new tab. */
export type NoticeLink = { href: string; external: boolean };

/** Who a notice's picture shows. */
export type NoticeFace =
	| { kind: "update" }
	| { kind: "warning" }
	| { kind: "provider"; provider: string; window: "plan" | "credits" }
	| { kind: "move"; move: YourMove; person: { name: string; avatarUrl: string | null } | null }
	| { kind: "slack"; person: { name: string; avatarUrl: string | null } };

/**
 * A notice's button: **Update** (`updating` while the update runs, and `ready` when it may run: before the update, and again after it failed), **Merge**,
 * which merges after a confirmation, the quick action that makes a pull request's move, or **Continue all**, which
 * resumes `sessionIds` and sends `continue` to each.
 */
export type NoticeAction =
	| { kind: "none" }
	| { kind: "update"; updating: boolean; ready: boolean }
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

/** How long a news toast stays. */
export const TOAST_MS = 6_000;

/** Why a routine's run exited early, as the bell words it after the routine's name. */
const EXIT_LABEL: Record<EarlyExit, string> = { errored: "errored", "no-reply": "ended with no reply", short: "ended far sooner than usual", missed: "missed its schedule" };

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
				headline: `Out of credit: ${providerLabel(notice.provider)}`,
				preview: `${notice.failures === 1 ? "A request" : `${notice.failures} requests`} to ${notice.model} failed since ${timeLabel(notice.since, now)}: ${notice.error}`,
				link: { href: hashForSettings("providers"), external: false },
				face: { kind: "provider", provider: notice.provider, window: "credits" },
			};
		case "stopped": {
			const count = notice.sessions.length;
			const [first] = notice.sessions;
			return {
				...NEWS,
				source: "sessions",
				headline: count === 1 ? "1 session stopped mid-turn" : `${count} sessions stopped mid-turn`,
				// Named as the sidebar names a past session.
				preview: notice.sessions.map(({ title, cwdDisplay }) => title ?? (cwdDisplay === null ? undefined : folderName(cwdDisplay)) ?? "Untitled session").join(" · "),
				// The first session it names, where you see how far its turn got before you continue it.
				link: first ? { href: hashForSession(first.sessionId), external: false } : null,
				face: { kind: "warning" },
				action: { kind: "continue-all", sessionIds: notice.sessions.map(({ sessionId }) => sessionId) },
				// It comes at the server's start, which you may not watch.
				toast: { kind: "news", timeout: 0 },
			};
		}
		case "routine-health": {
			const count = notice.runs.length;
			const [first] = notice.runs;
			return {
				...NEWS,
				source: "routines",
				headline: count === 1 ? "1 routine run exited early" : `${count} routine runs exited early`,
				preview: notice.runs.map(({ name, exit }) => `${name} ${EXIT_LABEL[exit]}`).join(" · "),
				// The first routine it names, whose runs show what went wrong.
				link: first ? { href: hashForBotRoutine(first.botId, { kind: "open", id: first.routineId }), external: false } : null,
				face: { kind: "warning" },
				// It comes once a day, which you may not watch.
				toast: { kind: "news", timeout: 0 },
			};
		}
		case "dashboard-failed":
			// No Update: origin still holds the commit that did not start, which it would only refuse.
			return {
				...NEWS,
				source: "updates",
				headline: "omp-agents update undone",
				preview: `omp-agents went back to ${shortCommit(notice.running)} until origin/${notice.branch} has a newer commit. ${didNotStart(notice.failed)}.`,
				failed: true,
				link: null,
				face: { kind: "update" },
				// It comes at the server's start, which you may not watch.
				toast: { kind: "news", timeout: 0 },
			};
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
						: { kind: "update", updating: status.state === "updating", ready: status.state === "available" || status.state === "failed" },
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
