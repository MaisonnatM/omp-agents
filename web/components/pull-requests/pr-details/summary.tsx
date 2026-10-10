import { Bot, Check, CircleDashed, CircleDot, CircleX, type LucideIcon, MessageSquare, Tag, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkedPullRequest, PullRequest, PullRequestDetail, Reviewer, ReviewerState, StackedPullRequest } from "../../../../src/shared/github";
import type { RosterHost } from "../../../../src/shared/sessions";
import { cn } from "@/lib/utils";
import { QuickActionButton, type QuickActionsProps } from "../../quick-actions";
import { LiveSessionChips } from "../../session-chip";
import { DetailSection, Markdown } from "../../sheet-details";
import { Avatar, IconTip } from "../avatars";
import { LabelDot, LabelsField, ReviewersField, type SavePullRequest, StateField, usePullRequestOptions } from "../pr-fields";
import type { DetailContentProps } from ".";
import { OtherPullRequests, StackSection } from "./stack";
import { type PlacedItem, TONE_COLOR, viewOf } from "./status-view";

const REVIEWER_ICON: Record<ReviewerState, [LucideIcon, string, string]> = {
	approved: [Check, "text-emerald-600 dark:text-emerald-400", "Approved"],
	"changes-requested": [CircleX, "text-red-600 dark:text-red-400", "Requested changes"],
	commented: [MessageSquare, "text-muted-foreground", "Commented"],
	requested: [CircleDashed, "text-amber-600 dark:text-amber-400", "Review requested"],
};

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
	return (
		<>
			<dt className="flex items-center gap-2 pt-1 text-muted-foreground @sm/pr:py-1">
				<Icon aria-hidden className="size-4" />
				{label}
			</dt>
			<dd className="min-w-0 pt-1 pb-2 @sm/pr:py-1">{children}</dd>
		</>
	);
}

function LabelChips({ labels }: { labels: PullRequestDetail["labels"] }) {
	if (labels.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<span className="flex flex-wrap gap-1.5">
			{labels.map(label => (
				<span key={label.name} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs">
					<LabelDot label={label} />
					{label.name}
				</span>
			))}
		</span>
	);
}

function StatusInline({ placed, quick }: { placed: PlacedItem[]; quick: QuickActionsProps }) {
	return (
		<ul className="space-y-1.5">
			{placed.map(({ item, fix }) => {
				const { tone, icon: Icon, text } = viewOf(item);
				return (
					<li key={item.kind} className="flex flex-wrap items-center gap-2">
						<Icon aria-hidden className={cn("size-4 shrink-0", TONE_COLOR[tone])} />
						<span className="min-w-0">{text(item)}</span>
						{fix && <QuickActionButton action={fix} pending={quick.pending} onRun={quick.onRun} />}
					</li>
				);
			})}
		</ul>
	);
}

function ReviewerInline({ reviewers }: { reviewers: Reviewer[] }) {
	if (reviewers.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
			{reviewers.map(reviewer => (
				<span key={reviewer.login} className="flex items-center gap-1.5">
					<Avatar person={reviewer} label={reviewer.login} />
					{reviewer.login}
					<IconTip icon={REVIEWER_ICON[reviewer.state]} />
				</span>
			))}
		</span>
	);
}

interface SummaryProps {
	pr: PullRequest;
	detail: PullRequestDetail;
	placed: PlacedItem[];
	quick: QuickActionsProps;
	stack: StackedPullRequest[];
	/** The session's pull requests outside the stack. */
	others: LinkedPullRequest[];
	sessions: RosterHost[];
	onOpen: DetailContentProps["onOpen"];
	onPick: DetailContentProps["onPick"];
	save: SavePullRequest;
	/** Why GitHub refused the last change; `null` when it took them all. */
	saveError: string | null;
}

export function Summary({ pr, detail, placed, quick, stack, others, sessions, onOpen, onPick, save, saveError }: SummaryProps) {
	const options = usePullRequestOptions(detail);
	// The state picker says it is a draft already.
	const blockers = placed.filter(({ item, fix }) => item.kind !== "draft" || fix);
	return (
		<div className="space-y-6">
			{saveError && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					GitHub did not take the change: {saveError}
				</p>
			)}
			<dl className="grid grid-cols-1 items-start gap-x-4 text-sm @sm/pr:grid-cols-[8rem_minmax(0,1fr)] @sm/pr:gap-y-1">
				<Property icon={CircleDot} label="Status">
					<div className="space-y-1.5">
						<StateField detail={detail} save={save} />
						{blockers.length > 0 && <StatusInline placed={blockers} quick={quick} />}
					</div>
				</Property>
				<Property icon={Users} label="Reviewers">
					<ReviewersField detail={detail} options={options} save={save}>
						<ReviewerInline reviewers={detail.reviewers} />
					</ReviewersField>
				</Property>
				<Property icon={Tag} label="Labels">
					<LabelsField detail={detail} options={options} save={save}>
						<LabelChips labels={detail.labels} />
					</LabelsField>
				</Property>
				{sessions.length > 0 && (
					<Property icon={Bot} label="Sessions">
						<LiveSessionChips hosts={sessions} onOpen={onOpen} />
					</Property>
				)}
			</dl>
			{stack.length > 0 && <StackSection stack={stack} current={pr} onPick={onPick} />}
			{others.length > 0 && onPick && <OtherPullRequests others={others} onPick={onPick} />}
			<DetailSection title="Description">{detail.body.trim() ? <Markdown text={detail.body} /> : <p className="text-sm text-muted-foreground">No description.</p>}</DetailSection>
		</div>
	);
}
