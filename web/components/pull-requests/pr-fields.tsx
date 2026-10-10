import { Tag, UserPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type PullRequestChange, type PullRequestDetail, type PullRequestLabel, type PullRequestOptions, type Reviewer, SETTABLE_STATES } from "../../../src/shared/github";
import { cn } from "@/lib/utils";
import { type ReadState, useRead } from "../../reads";
import { FieldPicker } from "../field-picker";
import { STATE_ICON } from "./avatars";

/** A pick's change, sent to GitHub, and what the details show until GitHub answers. */
export type SavePullRequest = (change: PullRequestChange, shown: Partial<PullRequestDetail>) => void;

const STATE_LABEL: Record<PullRequestDetail["state"], string> = { open: "Open", draft: "Draft", closed: "Closed", merged: "Merged" };

/** A picker's button laid in a property row: its text lines up with the row's, and it spans the row. */
const ROW_FIELD = "-mx-2 -my-1 h-auto min-h-7 w-[calc(100%+1rem)] justify-start px-2 py-1 text-sm font-normal text-foreground";

/** The repository's labels and reviewers; `open` asks GitHub for them, again after a failure. */
export type PullRequestOptionsRead = ReadState<PullRequestOptions> & { open: () => void };

/** The repository's labels and reviewers, asked of GitHub when a picker first opens. */
export function usePullRequestOptions(detail: PullRequestDetail): PullRequestOptionsRead {
	const [opened, setOpened] = useState(false);
	const [retry, setRetry] = useState(0);
	const read = useRead<PullRequestOptions>(opened ? `/api/pull-request/options?${new URLSearchParams({ owner: detail.owner, repo: detail.repo })}` : null, retry);
	return {
		...read,
		open: () => {
			setOpened(true);
			if (read.error) setRetry(count => count + 1);
		},
	};
}

function StateIcon({ state }: { state: PullRequestDetail["state"] }) {
	const [Icon, color] = STATE_ICON[state];
	return <Icon aria-hidden className={cn("size-4 shrink-0", color)} />;
}

/** Open, draft, or closed; a merged pull request keeps its state. */
export function StateField({ detail, save }: { detail: PullRequestDetail; save: SavePullRequest }) {
	const label = STATE_LABEL[detail.state];
	if (detail.state === "merged") {
		return (
			<span className="flex items-center gap-2">
				<StateIcon state="merged" />
				{label}
			</span>
		);
	}
	return (
		<FieldPicker
			field="State"
			current={label}
			className={ROW_FIELD}
			trigger={
				<>
					<StateIcon state={detail.state} />
					<span className="truncate">{label}</span>
				</>
			}
			choices={SETTABLE_STATES.map(state => ({ value: state, label: STATE_LABEL[state], icon: <StateIcon state={state} /> }))}
			selected={[detail.state]}
			onPick={value => {
				const state = SETTABLE_STATES.find(candidate => candidate === value);
				if (state && state !== detail.state) save({ field: "state", state }, { state });
			}}
		/>
	);
}

interface OptionsFieldProps {
	detail: PullRequestDetail;
	options: PullRequestOptionsRead;
	save: SavePullRequest;
	/** The field's value, shown on its button. */
	children: ReactNode;
}

/**
 * The review requests: a pick asks the person for a review, or withdraws the request, and asks again of someone who
 * already reviewed. A withdrawn request leaves the person's review in place.
 */
export function ReviewersField({ detail, options, save, children }: OptionsFieldProps) {
	const requested = detail.reviewers.filter(reviewer => reviewer.state === "requested").map(reviewer => reviewer.login);
	const names = detail.reviewers.map(reviewer => reviewer.login).join(", ");
	return (
		<FieldPicker
			field="Reviewers"
			current={names || "none"}
			className={ROW_FIELD}
			trigger={
				detail.reviewers.length > 0 ? (
					children
				) : (
					<>
						<UserPlus aria-hidden className="size-4 text-muted-foreground" />
						<span className="text-muted-foreground">Request a review</span>
					</>
				)
			}
			choices={options.data?.reviewers.filter(person => person.login !== detail.author.login).map(person => ({ value: person.login, label: person.login })) ?? null}
			error={options.error}
			selected={requested}
			multi
			disabled={detail.state === "merged"}
			onOpen={options.open}
			onPick={login => {
				const on = !requested.includes(login);
				const person = options.data?.reviewers.find(candidate => candidate.login === login);
				const reviewers: Reviewer[] = on
					? [{ login, avatarUrl: person?.avatarUrl ?? null, state: "requested" }, ...detail.reviewers.filter(reviewer => reviewer.login !== login)]
					: detail.reviewers.filter(reviewer => reviewer.login !== login);
				save({ field: "reviewer", login, on }, { reviewers });
			}}
		/>
	);
}

/** The labels, each a pick that adds or removes it. */
export function LabelsField({ detail, options, save, children }: OptionsFieldProps) {
	const names = detail.labels.map(label => label.name);
	return (
		<FieldPicker
			field="Labels"
			current={names.join(", ") || "none"}
			className={ROW_FIELD}
			trigger={
				detail.labels.length > 0 ? (
					children
				) : (
					<>
						<Tag aria-hidden className="size-4 text-muted-foreground" />
						<span className="text-muted-foreground">Add a label</span>
					</>
				)
			}
			choices={options.data?.labels.map(label => ({ value: label.name, label: label.name, icon: <LabelDot label={label} /> })) ?? null}
			error={options.error}
			selected={names}
			multi
			onOpen={options.open}
			onPick={name => {
				const on = !names.includes(name);
				const label = options.data?.labels.find(candidate => candidate.name === name) ?? { name, color: "888888" };
				save({ field: "label", name, on }, { labels: on ? [...detail.labels, label] : detail.labels.filter(other => other.name !== name) });
			}}
		/>
	);
}

export function LabelDot({ label }: { label: PullRequestLabel }) {
	return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} />;
}
