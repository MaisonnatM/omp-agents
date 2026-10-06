import { ArrowDown, ArrowUp, Pencil, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared/models";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError, errorText } from "../../api";
import type { ReadState } from "../../reads";

/** A settings text field or select. */
export const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The models `omp models` lists, for the pickers; loaded once per page. */
export type Catalog = ReadState<{ bySelector: ReadonlyMap<string, CatalogModel>; byProvider: ReadonlyMap<string, CatalogModel[]> }>;

/** What every editor shares: where it saves, the models it offers, and how the page takes a save's answer. */
export interface Editing {
	cwd: string | null;
	catalog: Catalog;
	saved: (settings: OmpSettings) => void;
	/** Re-read everything from disk, keeping the page as it is until the answer arrives. */
	reload: () => void;
}

type EditorState<T> =
	| { phase: "viewing" }
	| { phase: "editing"; draft: T; error: string | null; conflict: boolean }
	| { phase: "saving"; draft: T };

interface Editor<T> {
	state: EditorState<T>;
	/** What the controls show: the draft while editing, the saved value otherwise. */
	draft: T;
	dirty: boolean;
	start: () => void;
	change: (next: T) => void;
	cancel: () => void;
	submit: () => Promise<void>;
}

/** Edit, then save or cancel. A failed save keeps the draft and shows why, for another try. */
export function useEditor<T>(original: T, save: (draft: T) => Promise<OmpSettings>, saved: (settings: OmpSettings) => void): Editor<T> {
	const [state, setState] = useState<EditorState<T>>({ phase: "viewing" });
	const draft = state.phase === "viewing" ? original : state.draft;
	return {
		state,
		draft,
		dirty: state.phase !== "viewing" && JSON.stringify(draft) !== JSON.stringify(original),
		start: () => setState({ phase: "editing", draft: original, error: null, conflict: false }),
		change: next => setState(prev => (prev.phase === "editing" ? { phase: "editing", draft: next, error: null, conflict: false } : prev)),
		cancel: () => setState({ phase: "viewing" }),
		submit: async () => {
			if (state.phase !== "editing") return;
			setState({ phase: "saving", draft: state.draft });
			try {
				saved(await save(state.draft));
				setState({ phase: "viewing" });
			} catch (err) {
				const conflict = err instanceof ApiError && err.conflict;
				setState({ phase: "editing", draft: state.draft, error: errorText(err), conflict });
			}
		},
	};
}

/** Edit while viewing; Cancel and Save while editing, Save only once something changed. */
export function EditBar<T>({ editor, label, start = "Edit" }: { editor: Editor<T>; label: string; start?: string }) {
	if (editor.state.phase === "viewing") {
		return (
			<Button variant="ghost" size="compact" leadingIcon={Pencil} aria-label={`${start} ${label}`} onClick={editor.start}>
				{start}
			</Button>
		);
	}
	const saving = editor.state.phase === "saving";
	return (
		<div className="flex shrink-0 items-center gap-2">
			{editor.dirty && !saving && <span className="text-xs text-muted-foreground">Unsaved</span>}
			<Button variant="ghost" size="compact" disabled={saving} onClick={editor.cancel}>
				Cancel
			</Button>
			<Button variant="primary" size="compact" disabled={!editor.dirty} loading={saving} aria-label={`Save ${label}`} onClick={() => void editor.submit()}>
				Save
			</Button>
		</div>
	);
}

export function SaveError<T>({ editor }: { editor: Editor<T> }) {
	if (editor.state.phase !== "editing" || !editor.state.error) return null;
	return (
		<p role="alert" className="text-xs text-red-600 dark:text-red-400">
			Not saved: {editor.state.error}
		</p>
	);
}

export function Section({ title, meta, actions, children }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
	return (
		<section className="space-y-3">
			<div className="flex min-h-7 items-center justify-between gap-4">
				<div className="min-w-0">
					<h3 className="text-sm font-semibold">{title}</h3>
					{meta && <p className="text-xs text-muted-foreground">{meta}</p>}
				</div>
				{actions}
			</div>
			{children}
		</section>
	);
}

function OrderButton({ label, direction, disabled, onClick }: { label: string; direction: "up" | "down"; disabled: boolean; onClick: () => void }) {
	const name = direction === "up" ? "up" : "down";
	const button = (
		<Button variant="ghost" size="icon-compact" aria-label={`Move ${label} ${name}`} disabled={disabled} onClick={onClick}>
			{direction === "up" ? <ArrowUp /> : <ArrowDown />}
		</Button>
	);
	return (
		<Tooltip content={disabled ? `${label} is already ${direction === "up" ? "first" : "last"}` : `Move ${label} ${name}`} disabled={disabled}>
			{button}
		</Tooltip>
	);
}

/** Moves, removes, and appends entries of an ordered list; `render` draws one entry. */
export function OrderedList({
	items,
	label,
	onChange,
	render,
	add,
}: {
	items: string[];
	label: (item: string) => string;
	onChange: (items: string[]) => void;
	render: (item: string, index: number) => ReactNode;
	add: ReactNode;
}) {
	const move = (from: number, to: number): void => {
		const next = [...items];
		next.splice(to, 0, ...next.splice(from, 1));
		onChange(next);
	};
	return (
		<div className="space-y-1">
			<ol className="space-y-1 text-sm">
				{items.map((item, index) => (
					<li key={`${index}:${item}`} className="flex items-center gap-1">
						<span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
						<div className="min-w-0 flex-1">{render(item, index)}</div>
						<OrderButton label={label(item)} direction="up" disabled={index === 0} onClick={() => move(index, index - 1)} />
						<OrderButton label={label(item)} direction="down" disabled={index === items.length - 1} onClick={() => move(index, index + 1)} />
						<Tooltip content={`Remove ${label(item)}`}>
							<Button variant="ghost" size="icon-compact" aria-label={`Remove ${label(item)}`} onClick={() => onChange(items.filter((_, other) => other !== index))}>
								<X />
							</Button>
						</Tooltip>
					</li>
				))}
			</ol>
			{add}
		</div>
	);
}
