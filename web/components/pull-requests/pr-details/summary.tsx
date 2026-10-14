/** A pull request's Summary tab: labels, linked sessions, stack, and description. */
import { Bot, type LucideIcon, Tag } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkedPullRequest, PullRequest, PullRequestDetail, StackedPullRequest } from "../../../../src/shared/github";
import type { RosterHost } from "../../../../src/shared/sessions";
import { LiveSessionChips } from "../../session-chip";
import { DetailSection, Markdown } from "../../sheet-details";
import { LabelDot, LabelsField, type PullRequestOptionsRead, type SavePullRequest } from "../pr-fields";
import type { DetailContentProps } from ".";
import { OtherPullRequests, StackSection } from "./stack";

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

interface SummaryProps {
	pr: PullRequest;
	detail: PullRequestDetail;
	options: PullRequestOptionsRead;
	stack: StackedPullRequest[];
	/** The session's pull requests outside the stack. */
	others: LinkedPullRequest[];
	sessions: RosterHost[];
	onOpen: DetailContentProps["onOpen"];
	onPick: DetailContentProps["onPick"];
	save: SavePullRequest;
}

export function Summary({ pr, detail, options, stack, others, sessions, onOpen, onPick, save }: SummaryProps) {
	return (
		<div className="space-y-6">
			<dl className="grid grid-cols-1 items-start gap-x-4 text-sm @sm/pr:grid-cols-[8rem_minmax(0,1fr)] @sm/pr:gap-y-1">
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
