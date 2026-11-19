/** The Project memory tab's parts around one memory: its kind badge, who last changed it, and the form that edits, adds, or deletes it. */
import { useId, useState } from "react";
import { PROJECT_MEMORY_KINDS, type ProjectMemoryEntry, type ProjectMemoryKind, type ProjectMemoryOp, type ProjectMemoryView } from "../../../src/shared/memory-page";
import { Badge, badgeColors, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { dateLabel } from "../../labels";
import { useInlineConfirm } from "../../use-inline-confirm";
import { ErrorText, FIELD, useSaving } from "../settings/editor";

export const KIND_LABELS: Record<ProjectMemoryKind, string> = { decision: "Decision", fact: "Fact", lesson: "Lesson" };
const KIND_COLORS: Record<ProjectMemoryKind, BadgeColor> = { decision: "blue", fact: "gray", lesson: "amber" };
const LINE_MAX = 120;
const BODY_MAX = 2000;
const TEXTAREA = "w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Who last changed a memory: this page, or the session `#<id>` names, by the start of its id. */
export const sourceLabel = (source: string): string => (source === "#dashboard" ? "this page" : `session ${source.replace(/^#/, "").slice(0, 8)}`);

export function KindBadge({ kind }: { kind: ProjectMemoryKind }) {
	return (
		<Badge variant="dot" size="compact" color={KIND_COLORS[kind]}>
			{KIND_LABELS[kind]}
		</Badge>
	);
}

/** The kind's colored dot alone, as {@link KindBadge} draws it. */
export function KindDot({ kind }: { kind: ProjectMemoryKind }) {
	const color = KIND_COLORS[kind];
	return <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color === "gray" ? "var(--muted-foreground)" : badgeColors[color] }} />;
}

/**
 * The open memory's kind, line, and body, saved as one change; a new one also takes its slug.
 * `onSaved` gets the slug saved, and Delete asks for a second click.
 */
export function MemoryEditor({
	entry,
	send,
	onSaved,
	onDeleted,
}: {
	entry: ProjectMemoryEntry | null;
	send: (ops: ProjectMemoryOp[]) => Promise<ProjectMemoryView>;
	onSaved: (slug: string) => void;
	onDeleted: () => void;
}) {
	const ids = { slug: useId(), kind: useId(), line: useId(), body: useId() };
	const [slug, setSlug] = useState(entry?.slug ?? "");
	const [kind, setKind] = useState<ProjectMemoryKind>(entry?.kind ?? "fact");
	const [line, setLine] = useState(entry?.line ?? "");
	const [body, setBody] = useState(entry?.body ?? "");
	const saving = useSaving<"save" | "delete">();
	const confirm = useInlineConfirm(`project-memory:${entry?.slug ?? "new"}`);
	const busy = saving.saving !== null;
	const changed = entry === null || kind !== entry.kind || line !== entry.line || body !== entry.body;
	const ready = slug.trim() !== "" && line.trim() !== "" && body.trim() !== "";
	const save = (): void => {
		const name = slug.trim();
		const op: ProjectMemoryOp = { op: entry === null ? "add" : "update", slug: name, kind, line: line.trim(), body: body.trim() };
		saving.run("save", async () => {
			await send([op]);
			onSaved(name);
		});
	};
	const remove = (): void => {
		if (entry === null) return;
		saving.run("delete", async () => {
			await send([{ op: "delete", slug: entry.slug }]);
			onDeleted();
		});
	};
	return (
		<form
			aria-busy={busy}
			className={cn("w-full space-y-4 px-5 py-5 transition-opacity motion-reduce:transition-none", busy && "opacity-60")}
			onSubmit={event => {
				event.preventDefault();
				if (ready && changed && !busy) save();
			}}
		>
			{entry === null ? (
				<div className="space-y-1">
					<label htmlFor={ids.slug} className="text-sm font-medium">
						Slug
					</label>
					<input
						id={ids.slug}
						autoFocus
						value={slug}
						maxLength={48}
						placeholder="release-needs-tag"
						onChange={event => setSlug(event.target.value)}
						className={cn(FIELD, "w-full font-mono")}
					/>
					<p className="text-xs text-muted-foreground">Lowercase letters, digits, and hyphens, at most 48.</p>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Updated {dateLabel(entry.updated)} by {sourceLabel(entry.source)}
				</p>
			)}
			<div className="space-y-1">
				<span id={ids.kind} className="text-sm font-medium">
					Kind
				</span>
				<Select value={kind} disabled={busy} onValueChange={next => setKind(next as ProjectMemoryKind)}>
					<SelectTrigger aria-labelledby={ids.kind} className="w-40">
						<SelectValue>{(shown: unknown) => KIND_LABELS[shown as ProjectMemoryKind]}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{PROJECT_MEMORY_KINDS.map(each => (
							<SelectItem key={each} value={each}>
								{KIND_LABELS[each]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1">
				<div className="flex items-baseline justify-between gap-2">
					<label htmlFor={ids.line} className="text-sm font-medium">
						Line
					</label>
					<span className="text-xs text-muted-foreground tabular-nums">
						{line.length} / {LINE_MAX}
					</span>
				</div>
				<input id={ids.line} value={line} maxLength={LINE_MAX} readOnly={busy} onChange={event => setLine(event.target.value)} className={cn(FIELD, "w-full")} />
				<p className="text-xs text-muted-foreground">One self-contained line, which an agent reads in the index without the body.</p>
			</div>
			<div className="space-y-1">
				<div className="flex items-baseline justify-between gap-2">
					<label htmlFor={ids.body} className="text-sm font-medium">
						Body
					</label>
					<span className="text-xs text-muted-foreground tabular-nums">
						{body.length} / {BODY_MAX}
					</span>
				</div>
				<textarea
					id={ids.body}
					value={body}
					maxLength={BODY_MAX}
					readOnly={busy}
					rows={10}
					onChange={event => setBody(event.target.value)}
					onKeyDown={event => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					className={TEXTAREA}
				/>
			</div>
			{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
			<div className="flex items-center gap-2">
				<Button type="submit" variant="primary" size="compact" disabled={busy || !ready || !changed} loading={saving.saving === "save"} {...activityControl("memory.project.save")}>
					{entry === null ? "Add memory" : "Save"}
				</Button>
				{entry !== null && (
					<Button
						variant="destructive-outline"
						size="compact"
						className="ml-auto"
						disabled={busy}
						loading={saving.saving === "delete"}
						{...confirm.props("delete", remove)}
						{...activityControl("memory.project.delete")}
					>
						{confirm.isArmed("delete") ? "Confirm delete?" : "Delete"}
					</Button>
				)}
			</div>
		</form>
	);
}
