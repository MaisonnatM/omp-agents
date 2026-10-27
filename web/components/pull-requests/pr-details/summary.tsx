/** The Summary tab: reviewers and labels, the description and its editor, the checks, and the comments. */
import { Pencil, Tag, Users } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { MAX_PULL_REQUEST_BODY, type PullRequestDetail } from "../../../../src/shared/github";
import { Button } from "@/components/ui/button";
import { useAction } from "../../../use-action";
import { LabelsField, ReviewersField, type PullRequestOptionsRead, type SavePullRequest, type SendPullRequest } from "../pr-fields";
import { Reviewers } from "../avatars";
import { PullRequestMarkdown } from "../pr-markdown";
import { MetaRow } from "../../sheet-details";
import { presentChecks } from "../../../pull-request-checks";
import { Checks } from "./checks";
import { Comments } from "./comments";
import { SummarySection } from "./section";

function LabelChips({ labels }: { labels: PullRequestDetail["labels"] }) {
	if (labels.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<span className="flex flex-wrap gap-1">
			{labels.map(label => (
				<span
					key={label.name}
					style={{ "--label": `#${label.color}` } as CSSProperties}
					className="max-w-48 min-w-0 truncate rounded-md border border-[color-mix(in_srgb,var(--label)_32%,transparent)] bg-[color-mix(in_srgb,var(--label)_12%,transparent)] px-2 py-0.5 text-xs"
				>
					{label.name}
				</span>
			))}
		</span>
	);
}

function Description({ detail, send }: { detail: PullRequestDetail; send: SendPullRequest }) {
	const [editing, setEditing] = useState(false);
	const [body, setBody] = useState(detail.body);
	const [original, setOriginal] = useState(detail.body);
	const save = useAction(async () => {
		if (body !== original) await send({ field: "body", body, original, ...(!body.trim() ? { allowEmpty: true } : {}) });
		setEditing(false);
	}, "Could not save the description");
	const edit = (): void => {
		setBody(detail.body);
		setOriginal(detail.body);
		setEditing(true);
	};
	return (
		// Keyed on editing, so a collapsed section opens again for its editor.
		<SummarySection
			key={String(editing)}
			title="Description"
			actions={
				!editing && (
					<Button size="icon-xs" variant="ghost-muted" aria-label="Edit description" onClick={edit}>
						<Pencil aria-hidden className="size-3" />
					</Button>
				)
			}
		>
			{editing ? (
				<form
					className="space-y-2"
					onSubmit={event => {
						event.preventDefault();
						save.run();
					}}
					onKeyDown={event => {
						if (event.key !== "Escape" || save.pending) return;
						event.preventDefault();
						event.stopPropagation();
						setEditing(false);
					}}
				>
					<textarea
						autoFocus
						aria-label="Pull request description"
						placeholder="Describe this pull request"
						value={body}
						maxLength={MAX_PULL_REQUEST_BODY}
						disabled={save.pending}
						rows={10}
						onChange={event => setBody(event.target.value)}
						className="block max-h-[60vh] min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex justify-end gap-1">
						<Button type="button" variant="ghost" size="xs" disabled={save.pending} onClick={() => setEditing(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="outline" size="xs" loading={save.pending}>
							{save.pending ? "Saving..." : "Save"}
						</Button>
					</div>
				</form>
			) : (
				<PullRequestMarkdown text={detail.body.trim() ? detail.body : "_No description provided._"} repo={detail} />
			)}
		</SummarySection>
	);
}

interface SummaryProps {
	detail: PullRequestDetail;
	options: PullRequestOptionsRead;
	save: SavePullRequest;
	send: SendPullRequest;
}

export function Summary({ detail, options, save, send }: SummaryProps) {
	return (
		<div>
			<section className="space-y-2 px-4 pt-2.5 pb-1" aria-label="Pull request metadata">
				<MetaRow icon={Users} label="Reviewers">
					<ReviewersField pr={detail} options={options} onChange={(change, reviewers) => save(change, { reviewers })}>
						{detail.reviewers.length ? <Reviewers reviewers={detail.reviewers} /> : <span className="text-muted-foreground">None</span>}
					</ReviewersField>
				</MetaRow>
				<MetaRow icon={Tag} label="Labels">
					<LabelsField detail={detail} options={options} save={save}>
						<LabelChips labels={detail.labels} />
					</LabelsField>
				</MetaRow>
			</section>
			<Description detail={detail} send={send} />
			<SummarySection title="Checks" defaultOpen={false}>
				{detail.checkRuns.length === 0 ? <p className="text-xs text-muted-foreground">No checks reported.</p> : <Checks summary={presentChecks(detail.checkRuns)} />}
			</SummarySection>
			<Comments detail={detail} save={save} send={send} />
		</div>
	);
}
