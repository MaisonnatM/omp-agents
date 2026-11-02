/** Shared Settings editors, native setting rows and controls, queued writes, save errors, and sections. */
import { ArrowDown, ArrowUp, Lock, Pencil, X } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import type { AgentSettingChange, AgentSettingEdit, AgentSettingOption, AgentSettingRow } from "../../../src/shared/agent-settings";
import type { CatalogModel, OmpFile, OmpSettings } from "../../../src/shared/models";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorText } from "../../../src/json";
import { ApiError, putJson, settingsUrl } from "../../api";
import type { Editable } from "../../editable-read";
import { formatValue, isChanged, valueOf } from "../../omp-settings";
import type { ReadState } from "../../reads";
import { hashForSettings } from "../../routing";
import { ToggleSwitch } from "../toggle-switch";

/** A settings text field or select. */
export const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** An entry of a settings rail, such as Files' file list. */
export const RAIL_BUTTON = "flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/** A link in a settings note, to another section or a file. */
export const LINK = "text-foreground underline-offset-2 hover:underline";

/** Models changes its draft while typing; Save writes it. A blank field restores the draft's number on blur. */
export function NumberField({ value, onChange, ...props }: Omit<ComponentProps<"input">, "value" | "onChange" | "onBlur"> & { value: number; onChange: (value: number) => void }) {
	const [text, setText] = useState(String(value));
	return (
		<input
			{...props}
			type="number"
			inputMode="numeric"
			className={`${FIELD} w-28 tabular-nums`}
			value={text}
			onChange={event => {
				setText(event.target.value);
				const next = Number(event.target.value);
				if (event.target.value.trim() !== "" && Number.isFinite(next)) onChange(next);
			}}
			onBlur={() => setText(String(value))}
		/>
	);
}

/** The models `omp models` lists, for the pickers; loaded once per page. */
export type Catalog = ReadState<{ bySelector: ReadonlyMap<string, CatalogModel>; byProvider: ReadonlyMap<string, CatalogModel[]> }>;

/** What every editor shares: where it saves, the models it offers, and the page's settings, which its saves write through. */
export interface Editing {
	cwd: string | null;
	catalog: Catalog;
	/** Sends a save in turn with the page's other saves and shows what it answers. */
	write: Editable<OmpSettings>["write"];
	/** Re-read everything from disk, keeping the page as it is until the answer arrives. */
	reload: () => void;
}

/** Queue one write and refresh a conflicting read before reporting the failure to its editor. */
export async function writeOrReload<T>(target: { write: Editable<T>["write"]; reload: () => void }, send: () => Promise<T>): Promise<T> {
	try {
		return await target.write(send);
	} catch (err) {
		if (err instanceof ApiError && err.conflict) target.reload();
		throw err;
	}
}

export const saveAgentSetting = (editing: Pick<Editing, "cwd" | "write" | "reload">, edit: AgentSettingEdit): Promise<OmpSettings> =>
	writeOrReload(editing, () => putJson<OmpSettings>(settingsUrl("/agent", editing.cwd), edit));

/** A save-on-change control's pending value and error, kept beside that control. */
export function useSaving<K>() {
	const [state, setState] = useState<{ saving: K | null; error: string | null }>({ saving: null, error: null });
	return {
		...state,
		run: (key: K, send: () => Promise<unknown>): void => {
			setState({ saving: key, error: null });
			void send().then(
				() => setState({ saving: null, error: null }),
				(err: unknown) => setState({
					saving: null,
					error: err instanceof ApiError && err.conflict ? "Changed since you opened it. This shows it as it is now." : errorText(err),
				}),
			);
		},
	};
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
export function useEditor<T>(original: T, save: (draft: T) => Promise<OmpSettings>): Editor<T> {
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
				await save(state.draft);
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

/** A settings error, announced as it appears. */
export function ErrorText({ children }: { children: ReactNode }) {
	return (
		<p role="alert" className="text-xs text-red-600 dark:text-red-400">
			{children}
		</p>
	);
}

export function SaveError<T>({ editor }: { editor: Editor<T> }) {
	if (editor.state.phase !== "editing" || !editor.state.error) return null;
	return <ErrorText>Not saved: {editor.state.error}</ErrorText>;
}

/** A settings block, named by its `title`; leave out `title` when the page header already names it, so only `meta` and `actions` head it. */
export function Section({ title, meta, actions, children }: { title?: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
	const headingId = useId();
	return (
		<section aria-labelledby={title ? headingId : undefined} className="space-y-3">
			<div className="flex min-h-7 items-center justify-between gap-4">
				<div className="min-w-0">
					{title && (
						<h3 id={headingId} className="text-sm font-semibold">
							{title}
						</h3>
					)}
					{meta && <p className="text-xs text-muted-foreground">{meta}</p>}
				</div>
				{actions}
			</div>
			{children}
		</section>
	);
}

export function OrderButton({ label, direction, disabled, onClick }: { label: string; direction: "up" | "down"; disabled: boolean; onClick: () => void }) {
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

/** What a row needs from the section: its writer and the file that supplies a workspace value. */
export interface RowContext {
	editing: Pick<Editing, "cwd" | "write" | "reload">;
	/** The workspace settings file Files lists, which a locked row links to. */
	projectFile?: OmpFile;
	onOpenFile?: (path: string) => void;
}

/** What every control gets from its row: the ids that name and describe it, its value, and its save. */
interface ControlProps {
	row: AgentSettingRow;
	/** The id of the row's visible label, which names the control. */
	labelId: string;
	/** The id a native field takes, so the row's `<label>` focuses it. */
	controlId: string;
	value: unknown;
	disabled: boolean;
	onChange: (change: AgentSettingChange) => void;
}

/** A link to a file in Settings › Files, which opens it there. */
export function FileLink({ file, onOpenFile, children }: { file: OmpFile; onOpenFile: (path: string) => void; children: string }) {
	return (
		<a href={hashForSettings("files")} onClick={() => onOpenFile(file.path)} className={LINK}>
			{children}
		</a>
	);
}

function OptionSelect({ labelId, hintId, value, options, disabled, onPick }: { labelId: string; hintId: string | undefined; value: unknown; options: AgentSettingOption[]; disabled: boolean; onPick: (value: string | number) => void }) {
	// A value omp would not offer, written by hand, still shows as itself.
	const listed = options.some(option => option.value === value) || (typeof value !== "string" && typeof value !== "number") ? options : [...options, { value, label: String(value) }];
	return (
		<Select value={value} disabled={disabled} onValueChange={next => (typeof next === "string" || typeof next === "number") && onPick(next)}>
			<SelectTrigger aria-labelledby={labelId} aria-describedby={hintId} className="max-w-64 tabular-nums">
				<SelectValue>{(shown: unknown) => listed.find(option => option.value === shown)?.label ?? String(shown)}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{listed.map(option => (
					<SelectItem key={String(option.value)} value={option.value} className="tabular-nums">
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** A text field that saves on Enter or when it loses focus, and reverts on Escape. Clearing it removes your value. */
function TextControl({ row, controlId, value, disabled, onChange }: ControlProps) {
	const initial = row.credential || value === undefined ? "" : String(value);
	const [draft, setDraft] = useState(initial);
	const commit = (): void => {
		if (draft === initial) return;
		if (row.credential) setDraft("");
		onChange(draft === "" ? { reset: true } : { value: draft });
	};
	const placeholder = row.credential ? (value === undefined ? "Not set" : "Set. Type to replace it") : typeof row.default === "string" && row.default ? row.default : "Not set";
	return (
		<input
			id={controlId}
			type={row.credential ? "password" : "text"}
			autoComplete="off"
			spellCheck={false}
			disabled={disabled}
			value={draft}
			placeholder={placeholder}
			onChange={event => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={event => {
				if (event.key === "Enter") commit();
				else if (event.key === "Escape") setDraft(initial);
			}}
			className={cn(FIELD, "w-64 disabled:cursor-not-allowed disabled:opacity-50")}
		/>
	);
}

/** Unlike Models' draft field, this row saves on Enter or blur; Escape restores it, and clearing it removes your value. */
function NumberControl({ controlId, value, disabled, onChange, min }: ControlProps & { min: number }) {
	const initial = value === undefined ? "" : String(value);
	const [draft, setDraft] = useState(initial);
	const [invalid, setInvalid] = useState<string | null>(null);
	const commit = (): void => {
		if (draft === initial) return;
		if (draft.trim() === "") return onChange({ reset: true });
		const next = Number(draft);
		if (!Number.isSafeInteger(next) || next < min) return setInvalid(`Use a whole number of ${min} or more.`);
		setInvalid(null);
		onChange({ value: next });
	};
	return (
		<div className="space-y-1">
			<input
				id={controlId}
				type="number"
				inputMode="numeric"
				min={min}
				step={1}
				disabled={disabled}
				value={draft}
				aria-invalid={invalid ? true : undefined}
				aria-describedby={invalid ? `${controlId}-error` : undefined}
				onChange={event => { setDraft(event.target.value); setInvalid(null); }}
				onBlur={commit}
				onKeyDown={event => {
					if (event.key === "Enter") commit();
					else if (event.key === "Escape") { setDraft(initial); setInvalid(null); }
				}}
				className={cn(FIELD, "w-28 tabular-nums disabled:cursor-not-allowed disabled:opacity-50")}
			/>
			{invalid && <div id={`${controlId}-error`}><ErrorText>{invalid}</ErrorText></div>}
		</div>
	);
}

/** JSON text for a list or a map, saved on ⌘Enter or when it loses focus; Escape reverts it, and clearing it removes your value. */
function JsonControl({ controlId, value, disabled, onChange }: ControlProps) {
	const initial = value === undefined ? "" : JSON.stringify(value, null, 2);
	const [draft, setDraft] = useState(initial);
	const [invalid, setInvalid] = useState<string | null>(null);
	const commit = (): void => {
		if (draft === initial) return;
		if (draft.trim() === "") return onChange({ reset: true });
		try {
			onChange({ value: JSON.parse(draft) });
			setInvalid(null);
		} catch (err) {
			setInvalid(errorText(err));
		}
	};
	return (
		<div className="space-y-1">
			<textarea
				id={controlId}
				spellCheck={false}
				disabled={disabled}
				value={draft}
				rows={Math.min(12, Math.max(3, draft.split("\n").length))}
				onChange={event => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={event => {
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") commit();
					else if (event.key === "Escape") {
						setDraft(initial);
						setInvalid(null);
					}
				}}
				className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
			/>
			{invalid && <ErrorText>Not JSON: {invalid}</ErrorText>}
		</div>
	);
}

/** Some of omp's choices: in order, moved and removed in place, or each on or off. */
function ListControl({ row, labelId, options, ordered, value, disabled, onChange }: ControlProps & { options: AgentSettingOption[]; ordered: boolean }) {
	const items = Array.isArray(value) ? value.map(String) : [];
	const labelOf = (item: string): string => options.find(option => option.value === item)?.label ?? item;
	if (!ordered) {
		return (
			<ul aria-labelledby={labelId} className="grid gap-1.5 sm:grid-cols-2">
				{options.map(option => (
					<li key={String(option.value)}>
						<label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] has-[[data-disabled]]:cursor-not-allowed">
							<ToggleSwitch
								checked={items.includes(String(option.value))}
								disabled={disabled}
								onCheckedChange={on => onChange({ value: on ? [...items, String(option.value)] : items.filter(item => item !== String(option.value)) })}
							/>
							{option.label}
						</label>
					</li>
				))}
			</ul>
		);
	}
	const rest = options.filter(option => !items.includes(String(option.value)));
	return (
		<fieldset aria-labelledby={labelId} disabled={disabled} className="disabled:opacity-50">
			<OrderedList
				items={items}
				label={labelOf}
				onChange={next => onChange({ value: next })}
				render={item => <span className="text-[12px]">{labelOf(item)}</span>}
				add={
					rest.length > 0 && (
						<div className="pl-5">
							<Select value={null} onValueChange={next => next !== null && onChange({ value: [...items, String(next)] })}>
								<SelectTrigger aria-label={`Add to ${row.label}`}>
									<SelectValue placeholder="Add…" />
								</SelectTrigger>
								<SelectContent>
									{rest.map(option => (
										<SelectItem key={String(option.value)} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)
				}
			/>
		</fieldset>
	);
}

/** A request limit per provider: each one edited or removed in place, and a new one added below. */
function ProviderLimitsControl({ labelId, value, disabled, onChange }: ControlProps) {
	const limits: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const [provider, setProvider] = useState("");
	const [limit, setLimit] = useState("");
	const without = (name: string): Record<string, unknown> => Object.fromEntries(Object.entries(limits).filter(([other]) => other !== name));
	const add = (): void => {
		const name = provider.trim();
		if (!name || !(Number(limit) > 0)) return;
		onChange({ value: { ...limits, [name]: Number(limit) } });
		setProvider("");
		setLimit("");
	};
	return (
		<fieldset aria-labelledby={labelId} disabled={disabled} className="space-y-1.5 disabled:opacity-50">
			{Object.entries(limits).map(([name, current]) => (
				<div key={name} className="flex items-center gap-2 text-sm">
					<span className="w-40 truncate font-mono text-xs">{name}</span>
					<input
						type="number"
						inputMode="numeric"
						min={1}
						aria-label={`Request limit for ${name}`}
						defaultValue={String(current)}
						onBlur={event => {
							const next = event.currentTarget.value.trim();
							if (next === String(current)) return;
							onChange({ value: next === "" ? without(name) : { ...limits, [name]: Number(next) } });
						}}
						onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
						className={cn(FIELD, "w-24 tabular-nums")}
					/>
					<Tooltip content={`Remove the limit for ${name}`}>
						<Button variant="ghost" size="icon-compact" aria-label={`Remove the limit for ${name}`} onClick={() => onChange({ value: without(name) })}>
							<X />
						</Button>
					</Tooltip>
				</div>
			))}
			<div className="flex flex-wrap items-end gap-2">
				<label className="space-y-1 text-xs text-muted-foreground">
					Provider
					<input value={provider} onChange={event => setProvider(event.target.value)} className={cn(FIELD, "block w-40 text-foreground")} />
				</label>
				<label className="space-y-1 text-xs text-muted-foreground">
					Request limit
					<input
						type="number"
						inputMode="numeric"
						min={1}
						value={limit}
						onChange={event => setLimit(event.target.value)}
						onKeyDown={event => event.key === "Enter" && add()}
						className={cn(FIELD, "block w-24 tabular-nums text-foreground")}
					/>
				</label>
				<Button variant="secondary" size="compact" disabled={!provider.trim() || !(Number(limit) > 0)} onClick={add}>
					Add
				</Button>
			</div>
		</fieldset>
	);
}

/** The control a row's kind takes, whether it sits beside the label or below it, and whether it is a native field a `<label>` focuses. */
function rowControl(props: ControlProps, hintId: string | undefined): { element: ReactNode; placement: "inline" | "block"; native: boolean } {
	const { row, labelId, value, disabled, onChange } = props;
	// Keyed by the value, so a field's draft starts over from each answer.
	const key = JSON.stringify(value) ?? "";
	const { control } = row;
	switch (control.kind) {
		case "toggle":
			return { element: <ToggleSwitch aria-labelledby={labelId} checked={value === true} disabled={disabled} onCheckedChange={checked => onChange({ value: checked })} />, placement: "inline", native: false };
		case "select":
			return {
				element: <OptionSelect labelId={labelId} hintId={hintId} value={value} options={control.options} disabled={disabled} onPick={next => onChange({ value: next })} />,
				placement: "inline",
				native: false,
			};
		case "text":
			return { element: <TextControl key={key} {...props} />, placement: "inline", native: true };
		case "number":
			return { element: <NumberControl key={key} {...props} min={control.min} />, placement: "inline", native: true };
		case "json":
			return { element: <JsonControl key={key} {...props} />, placement: "block", native: true };
		case "list":
			return { element: <ListControl {...props} options={control.options} ordered={control.ordered} />, placement: "block", native: false };
		case "provider-limits":
			return { element: <ProviderLimitsControl key={key} {...props} />, placement: "block", native: false };
	}
}

/** One setting: what it does, whether it differs from omp's default, its control, and the layer notes that apply. */
export function SettingRow({ row, context: { editing, projectFile, onOpenFile }, mode = "immediate", hidden, disabled: blocked = false }: { row: AgentSettingRow; context: RowContext; mode?: "immediate" | "explicit"; hidden?: boolean; disabled?: boolean }) {
	const immediate = useSaving<{ shown: unknown }>();
	const [status, setStatus] = useState("");
	const editor = useEditor<{ change: AgentSettingChange; expected: unknown }>(
		{ change: { value: row.user ?? row.default }, expected: row.user ?? null },
		async draft => {
			const result = await saveAgentSetting(editing, { id: row.id, ...draft.change, expected: draft.expected });
			setStatus(`Saved ${row.label.toLowerCase()}.`);
			return result;
		},
	);
	const labelId = useId();
	const controlId = useId();
	const hintId = useId();
	const viewing = mode === "explicit" && editor.state.phase === "viewing";
	const saving = mode === "explicit" ? editor.state.phase === "saving" : immediate.saving !== null;
	const locked = row.workspace !== undefined;
	const value = mode === "explicit" && !viewing
		? "value" in editor.draft.change ? editor.draft.change.value : row.default
		: immediate.saving ? immediate.saving.shown : valueOf(row);
	const disabled = saving || blocked || (locked && mode === "immediate");
	const change = (next: AgentSettingChange): void => {
		setStatus("");
		if (mode === "explicit") {
			editor.change({ ...editor.draft, change: next });
		} else {
			immediate.run(
				{ shown: "value" in next ? next.value : locked ? row.workspace : row.default },
				() => saveAgentSetting(editing, { id: row.id, ...next, expected: row.user ?? null }),
			);
		}
	};
	const { control } = row;
	// A choice's own description, which omp shows beside it, shows under the row for the one picked.
	const picked = control.kind === "select" ? control.options.find(option => option.value === value) : undefined;
	const hint = picked?.description ? `${picked.label}: ${picked.description}` : undefined;
	const { element, placement, native } = rowControl({ row, labelId, controlId, value, disabled, onChange: change }, hint ? hintId : undefined);
	const changed = isChanged(row);
	// Only a native field takes a `<label>`; the switch, the select, and the lists are named by the label's id.
	const label = native && !viewing ? (
		<label id={labelId} htmlFor={controlId}>
			{row.label}
		</label>
	) : (
		<span id={labelId}>{row.label}</span>
	);
	return (
		<li hidden={hidden} aria-busy={saving} className={cn("space-y-2 py-3 transition-opacity motion-reduce:transition-none", saving && "opacity-60")}>
			<div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap sm:gap-6">
				<div className="min-w-0 space-y-0.5">
					<p className="flex items-center gap-1.5 text-sm font-medium">
						{label}
						{changed && (
							<Tooltip content={row.credential ? "Set" : `Changed. omp's default is ${formatValue(row, row.default)}`}>
								<span className="inline-flex size-4 items-center justify-center">
									<span aria-hidden className="size-1.5 rounded-full bg-primary" />
									<span className="sr-only">{row.credential ? "Set" : `Changed from omp's default, ${formatValue(row, row.default)}`}</span>
								</span>
							</Tooltip>
						)}
					</p>
					{row.warning && <p className="text-xs text-warning-foreground">{row.warning}</p>}
					<p className="text-xs text-muted-foreground">{row.description}</p>
					{hint && (
						<p id={hintId} className="text-xs text-muted-foreground">
							{hint}
						</p>
					)}
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{row.user !== undefined && !viewing && (
						<Tooltip content={`Remove your value from config.yml${locked ? "" : `, back to ${row.credential ? "none" : formatValue(row, row.default)}`}`}>
							<Button variant="ghost" size="compact" disabled={saving || blocked} onClick={() => change({ reset: true })}>
								Reset
							</Button>
						</Tooltip>
					)}
					{locked && <Lock aria-hidden className="size-3.5 text-muted-foreground" />}
					{placement === "inline" && !viewing && element}
					{viewing && <span className="text-sm tabular-nums">{formatValue(row, value)}</span>}
					{mode === "explicit" && <EditBar editor={editor} label={row.label} />}
				</div>
			</div>
			{placement === "block" && !viewing && element}
			{locked && (
				<p className="text-xs text-muted-foreground">
					This workspace sets it.{" "}
					{projectFile && onOpenFile && (
						<FileLink file={projectFile} onOpenFile={onOpenFile}>
							Open in Files
						</FileLink>
					)}
					{projectFile && ". "}
					Your value: {formatValue(row, row.user ?? (row.credential ? undefined : row.default))}
				</p>
			)}
			{row.env && (
				<p className="text-xs text-muted-foreground">
					<code className="font-mono">{row.env}</code> is set, and it overrides this value.
				</p>
			)}
			{mode === "explicit" ? <SaveError editor={editor} /> : immediate.error && <ErrorText>Not saved: {immediate.error}</ErrorText>}
			{status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
		</li>
	);
}
