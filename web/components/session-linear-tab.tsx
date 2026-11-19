/** The right sidebar's **Linear** tab: a Linear issue the session links to, or one typed in, read through omp's Linear MCP server. */
import { IconLinear, IconSquareArrowTopRight } from "central-icons";
import { type FormEvent, useMemo, useState } from "react";
import { type LinearIssue, linearIssueId, linearIssueIdsIn } from "../../src/shared/linear";
import type { View } from "../../src/shared/sessions";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { age } from "../labels";
import { useTranscript } from "../pane-store";
import { useRead } from "../reads";
import { DetailsEmpty } from "./details-sidebar-frame";
import { AGENT_PRESET, MessageMarkdown } from "./message-markdown";
import { Spinner } from "./spinner";

/** Each of Linear's state types in the colors Linear draws them. */
const STATUS_COLOR: Record<string, BadgeColor> = { triage: "orange", backlog: "gray", unstarted: "gray", started: "amber", completed: "indigo", canceled: "gray" };

/** The ids of the Linear issues `view`'s prompts and replies link to, in the order they first appear. */
export function useLinkedIssues(view: View): string[] {
	const items = useTranscript(view);
	const joined = useMemo(() => linearIssueIdsIn(items.flatMap(item => (item.kind === "user" || item.kind === "assistant" ? [item.text] : []))).join(" "), [items]);
	// Keyed by the joined ids, so the list keeps its identity while a reply streams and the ids stay the same.
	return useMemo(() => (joined === "" ? [] : joined.split(" ")), [joined]);
}

/** The tab: the picked issue, else the first one `linked` names, with a field to open another by id or link. Callers key it by session. */
export function SessionLinearTab({ linked }: { linked: string[] }) {
	const [picked, setPicked] = useState<string | null>(null);
	const shown = picked ?? linked[0] ?? null;
	const read = useRead<LinearIssue>(shown === null ? null : `/api/linear/issue?${new URLSearchParams({ id: shown })}`);
	const choices = picked !== null && !linked.includes(picked) ? [picked, ...linked] : linked;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<IssuePicker choices={choices} shown={shown} onPick={setPicked} />
			<div className="min-h-0 flex-1 overflow-y-auto">
				{shown === null ? (
					<DetailsEmpty icon={IconLinear} title="No Linear issue" description="Issues this session links to show here. Type an issue id or paste its link above to open another." />
				) : read.data ? (
					<IssueDetails issue={read.data} />
				) : read.error ? (
					<p role="alert" className="m-4 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
						Could not read {shown}: {read.error}
					</p>
				) : (
					<div className="flex justify-center py-10">
						<Spinner label={`Reading ${shown}`} className="size-4 text-muted-foreground" />
					</div>
				)}
			</div>
		</div>
	);
}

/** The field opening an issue by id or link, then a chip for each issue the session links to, the shown one pressed. */
function IssuePicker({ choices, shown, onPick }: { choices: string[]; shown: string | null; onPick: (id: string) => void }) {
	const [draft, setDraft] = useState("");
	const id = linearIssueId(draft);
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		if (id === null) return;
		onPick(id);
		setDraft("");
	};
	return (
		<div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
			<form onSubmit={submit}>
				<input
					aria-label="Linear issue id or link"
					placeholder="ENG-123 or an issue link"
					value={draft}
					onChange={event => setDraft(event.target.value)}
					aria-invalid={draft.trim() !== "" && id === null}
					className="h-7 w-full rounded-md border border-border bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
				/>
			</form>
			{choices.length > 1 && (
				<div role="group" aria-label="Issues this session links to" className="flex flex-wrap gap-1">
					{choices.map(choice => (
						<button
							key={choice}
							type="button"
							aria-pressed={choice === shown}
							onClick={() => onPick(choice)}
							className={cn("h-6 rounded-md border border-border px-2 font-mono text-2xs text-muted-foreground hover:text-foreground", choice === shown && "bg-surface-5 text-foreground")}
						>
							{choice}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** One issue: its id linking to Linear, status, title, who and where, labels, then its description. */
function IssueDetails({ issue }: { issue: LinearIssue }) {
	const facts = [issue.priority && `${issue.priority} priority`, issue.assignee ?? "Unassigned", issue.project ?? issue.team].filter(fact => !!fact);
	const updated = Date.parse(issue.updatedAt);
	return (
		<article className="px-4 py-3">
			<div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
				<a href={issue.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 font-medium underline-offset-2 hover:text-foreground hover:underline">
					{issue.id}
					<IconSquareArrowTopRight className="size-2.5" />
				</a>
				{issue.status && (
					<Badge variant="dot" size="compact" color={STATUS_COLOR[issue.statusType] ?? "gray"} className="shrink-0">
						{issue.status}
					</Badge>
				)}
				{Number.isFinite(updated) && <span className="ml-auto shrink-0">updated {age(updated)} ago</span>}
			</div>
			<h2 className="mt-2 text-base font-semibold leading-snug">{issue.title}</h2>
			{facts.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{facts.join(" · ")}</p>}
			{issue.labels.length > 0 && (
				<ul aria-label="Labels" className="mt-2 flex flex-wrap gap-1">
					{issue.labels.map(label => (
						<li key={label}>
							<Badge variant="dot" size="compact">
								{label}
							</Badge>
						</li>
					))}
				</ul>
			)}
			<div className="mt-4 text-sm">{issue.description ? <MessageMarkdown text={issue.description} preset={AGENT_PRESET} /> : <p className="text-muted-foreground">No description.</p>}</div>
		</article>
	);
}
