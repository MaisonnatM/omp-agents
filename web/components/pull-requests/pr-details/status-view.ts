import { CircleCheck, CircleDashed, CircleX, Eye, GitMerge, GitPullRequestDraft, type LucideIcon, MessageSquare } from "lucide-react";
import type { StatusItem } from "../../../pull-requests-model";
import type { PullRequestActionId } from "../../../../src/pull-request-actions";
import type { QuickActionId } from "../../../quick-actions";

const AND = new Intl.ListFormat("en", { type: "conjunction" });

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

type Tone = "blocked" | "waiting" | "done";

export const TONE_COLOR: Record<Tone, string> = {
	blocked: "text-red-600 dark:text-red-400",
	waiting: "text-amber-600 dark:text-amber-400",
	done: "text-emerald-600 dark:text-emerald-400",
};

interface ItemView<Item> {
	tone: Tone;
	icon: LucideIcon;
	text: (item: Item) => string;
	/** The quick action that works on it. */
	fix?: PullRequestActionId;
}

type StatusView = { [Kind in StatusItem["kind"]]: ItemView<Extract<StatusItem, { kind: Kind }>> };

/** How the details' Status says each fact. */
const STATUS_VIEW: StatusView = {
	ready: { tone: "done", icon: GitMerge, text: () => "Ready to merge" },
	draft: { tone: "waiting", icon: GitPullRequestDraft, text: () => "Draft, not ready for review" },
	conflicts: { tone: "blocked", icon: GitMerge, text: ({ base }) => `Merge conflicts with ${base}`, fix: "resolve-conflicts" },
	"checks-failing": { tone: "blocked", icon: CircleX, text: ({ count }) => `${plural(count, "check")} failed`, fix: "fix-ci" },
	"changes-requested": {
		tone: "blocked",
		icon: CircleX,
		text: ({ by }) => (by.length > 0 ? `Changes requested by ${AND.format(by)}` : "Changes requested"),
		fix: "address-comments",
	},
	threads: { tone: "blocked", icon: MessageSquare, text: ({ count, exact }) => `${count}${exact ? "" : "+"} review ${count === 1 && exact ? "thread" : "threads"} unresolved`, fix: "address-comments" },
	"checks-pending": { tone: "waiting", icon: CircleDashed, text: ({ count }) => `${plural(count, "check")} still running` },
	"review-required": {
		tone: "waiting",
		icon: Eye,
		text: ({ waitingOn }) => (waitingOn.length > 0 ? `Waiting on a review from ${AND.format(waitingOn)}` : "Waiting for a review"),
	},
	approved: { tone: "done", icon: CircleCheck, text: ({ by }) => (by.length > 0 ? `Approved by ${AND.format(by)}` : "Approved") },
	"checks-passing": {
		tone: "done",
		icon: CircleCheck,
		text: ({ passed, skipped }) => `${plural(passed, "check")} passed${skipped > 0 ? `, ${skipped} skipped` : ""}`,
	},
};

export const viewOf = <Item extends StatusItem>(item: Item): ItemView<Item> => STATUS_VIEW[item.kind] as ItemView<Item>;

export interface PlacedItem {
	item: StatusItem;
	fix: PullRequestActionId | null;
}

/** Each status item with the quick action it offers: one of `actions` that no item above it offers already. */
export function placeFixes(items: StatusItem[], actions: QuickActionId[]): PlacedItem[] {
	const offered = new Set<PullRequestActionId>();
	return items.map(item => {
		const { fix } = viewOf(item);
		if (!fix || !actions.includes(fix) || offered.has(fix)) return { item, fix: null };
		offered.add(fix);
		return { item, fix };
	});
}
