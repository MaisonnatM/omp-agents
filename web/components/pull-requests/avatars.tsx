import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";
import type { Person, PullRequestDetail, Reviewer, ReviewerState } from "../../../src/shared/github";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const STATE_ICON: Record<PullRequestDetail["state"], [LucideIcon, string, string]> = {
	open: [GitPullRequest, "text-emerald-600 dark:text-emerald-400", "Open pull request"],
	draft: [GitPullRequestDraft, "text-muted-foreground", "Draft pull request, not ready for review"],
	merged: [GitMerge, "text-violet-600 dark:text-violet-400", "Merged pull request"],
	closed: [GitPullRequestClosed, "text-red-600 dark:text-red-400", "Closed pull request"],
};

/** An icon with its meaning on hover, and to screen readers. */
export function IconTip({ icon: [Icon, color, label], className }: { icon: [LucideIcon, string, string]; className?: string }) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn("flex shrink-0", className)}>
				<Icon aria-hidden className={cn("size-4", color)} />
			</span>
		</Tooltip>
	);
}

interface AvatarProps {
	person: Person;
	label: string;
	/** A dot in the corner that marks where a reviewer stands. */
	dot?: string;
	className?: string;
}

export function Avatar({ person, label, dot, className }: AvatarProps) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn("relative inline-flex size-5 shrink-0 rounded-full bg-muted ring-2 ring-background", className)}>
				{person.avatarUrl ? (
					<img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-full object-cover" />
				) : (
					<span aria-hidden className="m-auto text-[10px] font-medium uppercase text-muted-foreground">
						{person.login[0]}
					</span>
				)}
				{dot && <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background", dot)} />}
			</span>
		</Tooltip>
	);
}

/** The dot on a reviewer's picture, and what their tooltip says they did. */
const REVIEWER_STATE: Record<ReviewerState, [string, (login: string) => string]> = {
	approved: ["bg-emerald-500", login => `${login} approved`],
	"changes-requested": ["bg-red-500", login => `${login} requested changes`],
	commented: ["bg-muted-foreground", login => `${login} commented`],
	requested: ["bg-amber-500", login => `Waiting on a review from ${login}`],
};

/** The reviewers' pictures, each marked with where they stand; past `max`, a `+N` names the rest in its tooltip. */
export function Reviewers({ reviewers, max = Infinity }: { reviewers: Reviewer[]; max?: number }) {
	if (reviewers.length === 0) return null;
	const rest = reviewers.slice(max);
	return (
		<span className="flex items-center -space-x-1">
			{reviewers.slice(0, max).map(reviewer => {
				const [dot, says] = REVIEWER_STATE[reviewer.state];
				return <Avatar key={reviewer.login} person={reviewer} label={says(reviewer.login)} dot={dot} />;
			})}
			{rest.length > 0 && (
				<Tooltip content={rest.map(reviewer => REVIEWER_STATE[reviewer.state][1](reviewer.login)).join("\n")}>
					<span className="pl-2 text-xs tabular-nums text-muted-foreground">+{rest.length}</span>
				</Tooltip>
			)}
		</span>
	);
}
