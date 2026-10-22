import { Bot, type LucideIcon, Tag, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkedPullRequest, PullRequest, PullRequestDetail, StackedPullRequest } from "../../../../src/shared/github";
import type { RosterHost } from "../../../../src/shared/sessions";
import { LiveSessionChips } from "../../session-chip";
import { DetailSection, Markdown } from "../../sheet-details";
import { LabelDot, LabelsField, ReviewersField, type PullRequestOptionsRead, type SavePullRequest } from "../pr-fields";
import type { DetailContentProps } from ".";
import { OtherPullRequests, StackSection } from "./stack";
import { Reviewers } from "../avatars";

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
	return (
		<>
			<dt className="flex min-h-7 items-center gap-1.5 text-muted-foreground sm:min-h-6">
				<Icon aria-hidden className="size-3.5" />
				{label}
			</dt>
			<dd className="flex min-h-7 min-w-0 items-center sm:min-h-6">{children}</dd>
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
			<dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs">
				<Property icon={Users} label="Reviewers">
					<ReviewersField detail={detail} options={options} save={save}>
						{detail.reviewers.length ? <Reviewers reviewers={detail.reviewers} /> : <span className="text-muted-foreground">None</span>}
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
