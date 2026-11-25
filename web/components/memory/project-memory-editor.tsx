/** The Project memory tab's parts around one memory: its kind dot, who last changed it, and the form that edits, adds, or deletes it. */
import { type KeyboardEvent, useId } from "react";
import { BODY_MAX, LINE_MAX, MEMORY_KINDS, type MemoryKind, type RawOp, SLUG_MAX, sourceTag } from "../../../templates/omp/agent/extensions/project-memory/contract";
import { DASHBOARD_SESSION, type ProjectMemoryEntry, type ProjectMemoryView } from "../../../src/shared/memory-page";
import { BadgeDot, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { dateLabel } from "../../labels";
import { useInlineConfirm } from "../../use-inline-confirm";
import { Field, TEXT_AREA } from "../form-field";
import { ErrorText, FIELD, useSaving } from "../settings/editor";

export const KIND_LABELS: Record<MemoryKind, string> = { decision: "Decision", fact: "Fact", lesson: "Lesson" };
const KIND_COLORS: Record<MemoryKind, BadgeColor> = { decision: "blue", fact: "gray", lesson: "amber" };
const DASHBOARD_SOURCE = sourceTag(DASHBOARD_SESSION);

/** The start of the id of the session that last changed a memory, `null` when this page did. */
export const sessionOf = (source: string): string | null => (source === DASHBOARD_SOURCE ? null : source.replace(/^#/, "").slice(0, 8));

/** The kind's colored dot, as a dot `Badge` draws it. */
export const KindDot = ({ kind }: { kind: MemoryKind }) => <BadgeDot color={KIND_COLORS[kind]} size="compact" />;

/** What the drawer's form holds for one memory, kept while it differs from the memory so closing the drawer loses nothing. */
export interface Draft {
	slug: string;
	kind: MemoryKind;
	line: string;
	body: string;
}

/** The form of `entry` as it is saved, or of a new memory. */
export const draftOf = (entry: ProjectMemoryEntry | null): Draft => ({ slug: entry?.slug ?? "", kind: entry?.kind ?? "fact", line: entry?.line ?? "", body: entry?.body ?? "" });

/** Whether `draft` holds no change to `entry`. */
export const isSaved = (entry: ProjectMemoryEntry | null, draft: Draft): boolean => {
	const saved = draftOf(entry);
	return draft.slug === saved.slug && draft.kind === saved.kind && draft.line === saved.line && draft.body === saved.body;
};

/**
 * The open memory's kind, line, and body in `draft`, saved as one change; a new one also takes its slug.
 * `onSaved` gets the slug saved, Revert puts the saved memory back, and Delete asks for a second click.
 */
export function MemoryEditor({
	entry,
	draft,
	onDraft,
	send,
	onSaved,
	onDeleted,
}: {
	entry: ProjectMemoryEntry | null;
	draft: Draft;
	onDraft: (draft: Draft) => void;
	send: (ops: RawOp[]) => Promise<ProjectMemoryView>;
	onSaved: (slug: string) => void;
	onDeleted: () => void;
}) {
	const ids = { slug: useId(), kind: useId(), line: useId(), body: useId() };
	const saving = useSaving<"save" | "delete">();
	const confirm = useInlineConfirm(`project-memory:${entry?.slug ?? "new"}`);
	const busy = saving.saving !== null;
	const changed = !isSaved(entry, draft);
	const ready = draft.slug.trim() !== "" && draft.line.trim() !== "" && draft.body.trim() !== "";
	const edit = (change: Partial<Draft>): void => onDraft({ ...draft, ...change });
	const save = (): void => {
		const slug = draft.slug.trim();
		const op: RawOp = { op: entry === null ? "add" : "update", slug, kind: draft.kind, line: draft.line.trim(), body: draft.body.trim() };
		saving.run("save", async () => {
			await send([op]);
			onSaved(slug);
		});
	};
	const remove = (): void => {
		if (entry === null) return;
		saving.run("delete", async () => {
			await send([{ op: "delete", slug: entry.slug }]);
			onDeleted();
		});
	};
	const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>, plain: boolean): void => {
		if (event.key !== "Enter" || event.shiftKey || (!plain && !event.metaKey && !event.ctrlKey)) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
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
				<Field label="Slug" htmlFor={ids.slug} hint={`Lowercase letters, digits, and hyphens, at most ${SLUG_MAX}.`}>
					<input id={ids.slug} autoFocus value={draft.slug} maxLength={SLUG_MAX} placeholder="release-needs-tag" onChange={event => edit({ slug: event.target.value })} className={cn(FIELD, "w-full font-mono")} />
				</Field>
			) : (
				<p className="text-xs text-muted-foreground">
					Updated {dateLabel(entry.updated)} by {sessionOf(entry.source) === null ? "this page" : `session ${sessionOf(entry.source)}`}
				</p>
			)}
			<Field label="Kind" htmlFor={ids.kind}>
				<Select value={draft.kind} disabled={busy} onValueChange={next => edit({ kind: next as MemoryKind })}>
					<SelectTrigger id={ids.kind} className="w-40">
						<SelectValue>{({ value }) => KIND_LABELS[value as MemoryKind]}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{MEMORY_KINDS.map(each => (
							<SelectItem key={each} value={each}>
								{KIND_LABELS[each]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
			<Field label="Line" htmlFor={ids.line} hint={<Counted text="One self-contained line, which an agent reads in the index without the body." length={draft.line.length} max={LINE_MAX} />}>
				<textarea
					id={ids.line}
					rows={1}
					value={draft.line}
					maxLength={LINE_MAX}
					readOnly={busy}
					onChange={event => edit({ line: event.target.value.replace(/[\r\n]+/g, " ") })}
					onKeyDown={event => submitOnEnter(event, true)}
					className={cn(TEXT_AREA, "resize-none [field-sizing:content]")}
				/>
			</Field>
			<Field label="Body" htmlFor={ids.body} hint={<Counted length={draft.body.length} max={BODY_MAX} />}>
				<textarea id={ids.body} value={draft.body} maxLength={BODY_MAX} readOnly={busy} rows={10} onChange={event => edit({ body: event.target.value })} onKeyDown={event => submitOnEnter(event, false)} className={cn(TEXT_AREA, "resize-y")} />
			</Field>
			{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
			<div className="flex items-center gap-2">
				<Button type="submit" variant="primary" size="compact" disabled={busy || !ready || !changed} loading={saving.saving === "save"} {...activityControl("memory.project.save")}>
					{entry === null ? "Add memory" : "Save"}
				</Button>
				{changed && (
					<Button variant="ghost" size="compact" disabled={busy} onClick={() => onDraft(draftOf(entry))}>
						{entry === null ? "Clear" : "Revert"}
					</Button>
				)}
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

/** A field's hint with how many of its `max` characters it holds. */
function Counted({ text, length, max }: { text?: string; length: number; max: number }) {
	return (
		<span className="flex items-baseline justify-between gap-3">
			<span>{text}</span>
			<span className="shrink-0 tabular-nums">
				{length} / {max}
			</span>
		</span>
	);
}
