/** A pull request's stack on a rail (`StackSection`, `StackRail`), and the session's other pull requests outside it. */
import { GitPullRequest, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { type LinkedPullRequest, type PullRequest, prKey, type StackedPullRequest, samePullRequest } from "../../../../src/shared/github";
import { age, LINK_VERB } from "../../../labels";
import { hashForPullRequests } from "../../../routing";
import { Rail, RailRow } from "../../rail";
import { DetailSection } from "../../sheet-details";
import { Avatar } from "../avatars";
import { ChecksIcon } from "../pr-row";

/** The pull requests stacked with this one, top first, on a rail down to the branch the bottom one merges into; each other one links to its details, or `onPick` shows it in place. */
export function StackSection({ stack, current, onPick }: { stack: StackedPullRequest[]; current: PullRequest; onPick?: (pr: PullRequest) => void }) {
	const at = stack.findIndex(pr => samePullRequest(pr, current));
	return (
		<DetailSection
			title={
				<>
					<Layers aria-hidden className="size-3.5 self-center" />
					Stack <span className="tabular-nums">{stack.length - at} of {stack.length}</span>
				</>
			}
		>
			<StackRail stack={stack} current={current} onPick={onPick} className="rounded-md border border-border" />
		</DetailSection>
	);
}

interface StackRailProps {
	stack: StackedPullRequest[];
	/** The one marked as here, which links nowhere. */
	current?: PullRequest;
	onPick?: (pr: PullRequest) => void;
	/** What ends each row, after its checks and age. */
	trailing?: (pr: StackedPullRequest) => ReactNode;
	className?: string;
}

/** `stack`, top first, on a rail down to the branch the bottom one merges into; each one but `current` links to its details, or `onPick` shows it in place. */
export function StackRail({ stack, current, onPick, trailing, className }: StackRailProps) {
	const bottom = stack[stack.length - 1];
	if (!bottom) return null;
	return (
		<Rail end={bottom.base} className={className}>
			{stack.map((pr, index) => {
				const here = current !== undefined && samePullRequest(pr, current);
				const label = `#${pr.number} ${pr.title}`;
				return (
					<RailRow key={pr.number} first={index === 0} here={here}>
						<Avatar person={pr.author} label={pr.author.login} />
						{here ? (
							<span aria-current="page" className="min-w-0 flex-1 truncate font-medium">
								{label}
							</span>
						) : onPick ? (
							<button type="button" onClick={() => onPick(pr)} className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline">
								{label}
							</button>
						) : (
							<a href={hashForPullRequests(pr)} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
								{label}
							</a>
						)}
						<ChecksIcon checks={pr.checks} />
						<span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{age(pr.updatedAt, { compact: true })}</span>
						{trailing?.(pr)}
					</RailRow>
				);
			})}
		</Rail>
	);
}

/** The session's pull requests outside the stack, each shown in place on click. */
export function OtherPullRequests({ others, onPick }: { others: LinkedPullRequest[]; onPick: (pr: PullRequest) => void }) {
	return (
		<DetailSection title="Other pull requests of the session">
			<ul className="rounded-md border border-border py-1">
				{others.map(pr => (
					<li key={prKey(pr)}>
						<button type="button" onClick={() => onPick(pr)} className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted">
							<GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate tabular-nums">
								{pr.repo} #{pr.number}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">{LINK_VERB[pr.link]}</span>
						</button>
					</li>
				))}
			</ul>
		</DetailSection>
	);
}
