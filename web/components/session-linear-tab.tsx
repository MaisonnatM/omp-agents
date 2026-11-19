/** The right sidebar's **Linear** tab: a Linear issue the session links to, or one typed in, read through omp's Linear MCP server. */
import { IconChevronDownSmall, IconLinear, IconSquareArrowTopRight } from "central-icons";
import { type FormEvent, useId, useMemo, useState } from "react";
import { type LinearIssue, linearIssueId, linearIssueIdsIn } from "../../src/shared/linear";
import type { View } from "../../src/shared/sessions";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { age } from "../labels";
import { useTranscript } from "../pane-store";
import { useRead } from "../reads";
import { DetailsEmpty } from "./details-sidebar-frame";
import { ERROR_TEXT } from "./form-dialog";
import { FIELD } from "./form-field";
import { GITHUB_PRESET, MessageMarkdown } from "./message-markdown";
import { LoadNote } from "./sheet-details";

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
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<IssueToolbar linked={linked} shown={shown} onPick={setPicked} />
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{shown === null ? (
					<DetailsEmpty icon={IconLinear} title="No Linear issue" description="Type an issue id or paste its link above to open one." />
				) : read.data ? (
					<IssueDetails issue={read.data} />
				) : (
					<div className="px-4 py-4">
						<LoadNote loading={`Asking Linear for ${shown}…`} error={read.error ? `Cannot load ${shown}: ${read.error}` : null} />
					</div>
				)}
			</div>
		</div>
	);
}

/** With two linked issues or more, a menu picking another, then the field opening any issue by id or link; a typed issue shows without joining the menu. */
function IssueToolbar({ linked, shown, onPick }: { linked: string[]; shown: string | null; onPick: (id: string) => void }) {
	const [draft, setDraft] = useState("");
	const [invalid, setInvalid] = useState(false);
	const errorId = useId();
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		if (draft.trim() === "") return;
		const id = linearIssueId(draft);
		if (id === null) return setInvalid(true);
		onPick(id);
		setDraft("");
	};
	return (
		<div className="shrink-0 border-b border-border px-4 py-2">
			<div className="flex min-w-0 items-center gap-2">
				{linked.length > 1 && (
					<DropdownMenu>
						<DropdownMenuTrigger
							{...activityControl("linear.issue")}
							render={<Button variant="ghost" size="compact" trailingIcon={IconChevronDownSmall} aria-label={`${shown ?? "No issue"}, pick one of ${linked.length} linked issues`} className="shrink-0 font-mono font-medium text-foreground" />}
						>
							{shown}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
							<MenuRadioGroup aria-label="Linked issues" value={shown ?? ""} onValueChange={(id: string) => onPick(id)}>
								{linked.map(id => (
									<MenuRadioItem key={id} value={id} closeOnClick className="font-mono">
										{id}
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<form onSubmit={submit} className="min-w-0 flex-1">
					<input
						{...activityControl("linear.open")}
						aria-label="Linear issue id or link"
						placeholder="ENG-123 or an issue link"
						value={draft}
						onChange={event => {
							setDraft(event.target.value);
							setInvalid(false);
						}}
						aria-invalid={invalid || undefined}
						aria-describedby={invalid ? errorId : undefined}
						className={cn(FIELD, "w-full")}
					/>
				</form>
			</div>
			{invalid && (
				<p id={errorId} className={cn(ERROR_TEXT, "mt-1.5")}>
					Enter an issue id such as ENG-123, or paste its Linear link.
				</p>
			)}
		</div>
	);
}

/** One issue as the PR header shows a pull request: its id linking to Linear, status, and when it changed, its title, who and where, then labels and description. */
function IssueDetails({ issue }: { issue: LinearIssue }) {
	const updated = Date.parse(issue.updatedAt);
	const where = issue.project ?? issue.team;
	// Each part after the first carries its own separator, so a part the narrow header hides takes its separator with it.
	const meta: { key: string; text: string; className?: string }[] = [
		...(issue.priority ? [{ key: "priority", text: `${issue.priority} priority`, className: "shrink-0" }] : []),
		{ key: "assignee", text: issue.assignee ?? "Unassigned", className: "text-foreground" },
		...(where ? [{ key: "where", text: where, className: "@max-[24rem]/linear-header:hidden" }] : []),
	];
	return (
		<article className="@container/linear-header min-w-0 px-4 pb-4 pt-3">
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
				{Number.isFinite(updated) && <span className="ml-auto min-w-0 truncate @max-[20rem]/linear-header:hidden">updated {age(updated)} ago</span>}
			</div>
			<h1 className="mt-2 text-base font-semibold">{issue.title}</h1>
			<div className="mt-2 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
				{meta.map((part, index) => (
					<span key={part.key} className={cn("flex min-w-0 items-center gap-2", part.className)}>
						{index > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
						<span className="truncate">{part.text}</span>
					</span>
				))}
			</div>
			{issue.labels.length > 0 && (
				<ul aria-label="Labels" className="mt-3 flex flex-wrap gap-1">
					{issue.labels.map(label => (
						<li key={label} className="max-w-48 min-w-0 truncate rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs">
							{label}
						</li>
					))}
				</ul>
			)}
			<div className="mt-4 text-[15px] leading-6 [&_.message-markdown_:is(h1,h2,h3)]:text-[1em]!">
				{issue.description ? <MessageMarkdown text={issue.description} preset={GITHUB_PRESET} /> : <p className="text-muted-foreground">No description.</p>}
			</div>
		</article>
	);
}
