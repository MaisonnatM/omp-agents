/** People and state on pull requests: avatars, reviewer pictures marked by their review, and icon tooltips. */
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

const PICTURE = "relative inline-flex shrink-0 rounded-full bg-muted";

/** The person's picture, or the first letter of their login when GitHub has none. */
function Picture({ person }: { person: Person }) {
	return person.avatarUrl ? (
		<img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-full object-cover" />
	) : (
		<span aria-hidden className="m-auto text-[10px] font-medium uppercase text-muted-foreground">
			{person.login[0]}
		</span>
	);
}

export function Avatar({ person, label, dot, className }: AvatarProps) {
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className={cn(PICTURE, "size-5 ring-2 ring-background", className)}>
				<Picture person={person} />
				{dot && <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background", dot)} />}
			</span>
		</Tooltip>
	);
}

/** A person's picture beside their name, as a picker's choices show them; the name says who, so screen readers skip it. */
export function PersonPicture({ person }: { person: Person }) {
	return (
		<span aria-hidden className={cn(PICTURE, "size-4")}>
			<Picture person={person} />
		</span>
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
