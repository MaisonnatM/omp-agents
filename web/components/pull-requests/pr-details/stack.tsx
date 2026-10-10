import { GitPullRequest, Layers } from "lucide-react";
import { type LinkedPullRequest, type PullRequest, prKey, type StackedPullRequest, samePullRequest } from "../../../../src/shared/github";
import { cn } from "@/lib/utils";
import { age, LINK_VERB } from "../../../labels";
import { hashForPullRequests } from "../../../routing";
import { DetailSection } from "../../sheet-details";
import { Avatar } from "../avatars";
import { ChecksIcon } from "../pr-row";

const RAIL = "absolute left-3.5 w-px bg-muted-foreground/30";
const RAIL_DOT = "absolute top-1/2 left-[10.5px] size-2 -translate-y-1/2 rounded-full ring-2 ring-background";

/** The pull requests stacked with this one, top first, on a rail down to the branch the bottom one merges into; each other one links to its details, or `onPick` shows it in place. */
export function StackSection({ stack, current, onPick }: { stack: StackedPullRequest[]; current: PullRequest; onPick?: (pr: PullRequest) => void }) {
	const at = stack.findIndex(pr => samePullRequest(pr, current));
	const bottom = stack[stack.length - 1];
	return (
		<DetailSection
			title={
				<>
					<Layers aria-hidden className="size-3.5 self-center" />
					Stack <span className="tabular-nums">{stack.length - at} of {stack.length}</span>
				</>
			}
		>
			<ol className="rounded-md border border-border py-1">
				{stack.map((pr, index) => {
					const here = index === at;
					const label = `#${pr.number} ${pr.title}`;
					return (
						<li key={pr.number} className={cn("relative flex items-center gap-2 py-1.5 pr-3 pl-8 text-sm", here && "bg-muted/60")}>
							<span aria-hidden className={cn(RAIL, index === 0 ? "top-1/2" : "top-0", "bottom-0")} />
							<span aria-hidden className={cn(RAIL_DOT, here ? "bg-primary" : "bg-muted-foreground/60")} />
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
						</li>
					);
				})}
				<li className="relative py-1.5 pr-3 pl-8 font-mono text-xs text-muted-foreground">
					<span aria-hidden className={cn(RAIL, "top-0 bottom-1/2")} />
					<span aria-hidden className={cn(RAIL_DOT, "bg-background ring-muted-foreground/60")} />
					{bottom.base}
				</li>
			</ol>
		</DetailSection>
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
