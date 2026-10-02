import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, FileText, FolderOpen, type LucideIcon, Monitor, Moon, Palette, Pencil, Plus, RotateCcw, Route, Sun, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CatalogModel, ModelChain, ModelRouting, OmpFile, OmpSettings, RetrySettings, RoleRoute } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { loadModels, loadSettings, SettingsRequestError, saveFile, saveRouting } from "../settings-api";
import { type Theme, THEMES, useTheme } from "../theme";
import { FILE_KIND_LABELS, fileGroups, hashForSettings, modelLabel, providerOrg, splitSelector } from "../view-model";
import { Header } from "./conversation";
import { Model, ModelRow, modelDescription, ProviderHeading } from "./model-picker";
import { OrgIcon } from "./org-icon";

type Load = { phase: "loading" } | { phase: "loaded"; settings: OmpSettings } | { phase: "failed"; error: string };

/** The models `omp models` lists, for the pickers; loaded once per page. */
type Catalog =
	| { phase: "loading" }
	| { phase: "loaded"; bySelector: ReadonlyMap<string, CatalogModel>; byProvider: [string, CatalogModel[]][] }
	| { phase: "failed"; error: string };

/** What every editor shares: where it saves, the models it offers, and how the page takes a save's answer. */
interface Editing {
	cwd: string | null;
	catalog: Catalog;
	saved: (settings: OmpSettings) => void;
	/** Re-read everything from disk, keeping the page as it is until the answer arrives. */
	reload: () => Promise<void>;
}

type Workspace = { cwd: string; cwdDisplay: string };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const onOff = (value: boolean | number | string): string => (value ? "On" : "Off");
const duration = (value: boolean | number | string): string =>
	Number(value) < 1000 ? `${value} ms` : Number(value) < 60_000 ? `${Number(value) / 1000} s` : `${Number(value) / 60_000} min`;

/** `retry.*` rows in the order they matter for fallback, with omp's key, how each value reads, and the unit it is edited in. */
const RETRY_ROWS: [keyof RetrySettings, string, (value: boolean | number | string) => string, string?][] = [
	["modelFallback", "Model fallback", onOff],
	["usageAwareFallback", "Usage-aware fallback", onOff],
	["usageReservePct", "Reserve margin", value => `${value}%`, "%"],
	["usageReservePolicy", "Reserve policy", String],
	["fallbackRevertPolicy", "Return to primary", String],
	["enabled", "Retry on API errors", onOff],
	["maxRetries", "Retry attempts", String],
	["baseDelayMs", "Base delay", duration, "ms"],
	["maxDelayMs", "Max delay", value => (Number(value) === 0 ? "No ceiling" : duration(value)), "ms"],
	["waitForUsageReset", "Wait for usage reset", onOff],
];

const FIELD = "h-7 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
function useEditor<T>(original: T, save: (draft: T) => Promise<OmpSettings>, saved: (settings: OmpSettings) => void): Editor<T> {
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
				const conflict = err instanceof SettingsRequestError && err.conflict;
				setState({ phase: "editing", draft: state.draft, error: errorText(err), conflict });
			}
		},
	};
}

/** Edit while viewing; Cancel and Save while editing, Save only once something changed. */
function EditBar<T>({ editor, label, start = "Edit" }: { editor: Editor<T>; label: string; start?: string }) {
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

function SaveError<T>({ editor }: { editor: Editor<T> }) {
	if (editor.state.phase !== "editing" || !editor.state.error) return null;
	return (
		<p role="alert" className="text-xs text-red-600 dark:text-red-400">
			Not saved: {editor.state.error}
		</p>
	);
}

function Section({ title, meta, actions, children }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
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

/** Fallbacks in the order omp tries them. */
function Chain({ fallbacks }: { fallbacks: string[] }) {
	if (fallbacks.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<ol className="flex flex-wrap gap-x-4 gap-y-1">
			{fallbacks.map((selector, index) => (
				<li key={`${index}:${selector}`} className="flex items-baseline gap-1.5">
					<span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
					<Model selector={selector} />
				</li>
			))}
		</ol>
	);
}

/** A model `omp models` lists, then its thinking level. The value is omp's selector, `provider/id` with an optional `:level`. */
function SelectorPicker({ value, catalog, label, onPick }: { value: string | null; catalog: Catalog; label: string; onPick: (selector: string) => void }) {
	const [open, setOpen] = useState(false);
	const models = catalog.phase === "loaded" ? catalog.bySelector : null;
	const { model, level } = value && models ? splitSelector(value, models) : { model: value, level: null };
	const levels = (model && models?.get(model)?.thinking) || [];
	const pickModel = (next: CatalogModel): void => {
		setOpen(false);
		onPick(level && next.thinking.includes(level) ? `${next.selector}:${level}` : next.selector);
	};
	return (
		<div className="flex min-w-0 items-center gap-1">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="compact" trailingIcon={ChevronsUpDown} aria-label={`${label}: ${model ? modelDescription(model) : "none"}`} active={open} className="min-w-0">
						<span className="max-w-56 truncate">{model ? <Model selector={model} /> : "Choose a model"}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
					<Command>
						<CommandInput aria-label="Search models" placeholder="Search models…" />
						<CommandList>
							{catalog.phase === "loading" ? (
								<p role="status" className="py-6 text-center text-sm text-muted-foreground">
									Loading models…
								</p>
							) : catalog.phase === "failed" ? (
								<p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
									{catalog.error}
								</p>
							) : (
								<>
									<CommandEmpty>No model matches.</CommandEmpty>
									{catalog.byProvider.map(([provider, group]) => (
										<CommandGroup key={provider} heading={<ProviderHeading provider={provider} />}>
											{group.map(option => (
												<CommandItem
													key={option.selector}
													value={option.selector}
													keywords={[modelLabel(option.selector), option.name]}
													title={option.selector}
													onSelect={() => pickModel(option)}
												>
													<ModelRow selector={option.selector} id={option.selector.slice(provider.length + 1)} selected={option.selector === model} />
												</CommandItem>
											))}
										</CommandGroup>
									))}
								</>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{model && (levels.length > 0 || level) && (
				<select
					aria-label={`${label}: thinking level`}
					className={FIELD}
					value={level ?? ""}
					onChange={event => onPick(event.target.value ? `${model}:${event.target.value}` : model)}
				>
					<option value="">default</option>
					{[...new Set([...levels, ...(level ? [level] : [])])].map(option => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			)}
		</div>
	);
}

/** Moves, removes, and appends entries of an ordered list; `render` draws one entry. */
function OrderedList({
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
						<Button variant="ghost" size="icon-compact" aria-label={`Move ${label(item)} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
							<ArrowUp />
						</Button>
						<Button
							variant="ghost"
							size="icon-compact"
							aria-label={`Move ${label(item)} down`}
							disabled={index === items.length - 1}
							onClick={() => move(index, index + 1)}
						>
							<ArrowDown />
						</Button>
						<Button variant="ghost" size="icon-compact" aria-label={`Remove ${label(item)}`} onClick={() => onChange(items.filter((_, other) => other !== index))}>
							<X />
						</Button>
					</li>
				))}
			</ol>
			{add}
		</div>
	);
}

function ChainEditor({ chain, catalog, onChange }: { chain: string[]; catalog: Catalog; onChange: (chain: string[]) => void }) {
	const [adding, setAdding] = useState(false);
	return (
		<OrderedList
			items={chain}
			label={selector => `fallback ${selector}`}
			onChange={onChange}
			render={(selector, index) => (
				<SelectorPicker
					value={selector}
					catalog={catalog}
					label={`Fallback ${index + 1}`}
					onPick={next => onChange(chain.map((entry, other) => (other === index ? next : entry)))}
				/>
			)}
			add={
				adding ? (
					<div className="flex items-center gap-1 pl-5">
						<SelectorPicker
							value={null}
							catalog={catalog}
							label="New fallback"
							onPick={selector => {
								setAdding(false);
								onChange([...chain, selector]);
							}}
						/>
						<Button variant="ghost" size="icon-compact" aria-label="Stop adding a fallback" onClick={() => setAdding(false)}>
							<X />
						</Button>
					</div>
				) : (
					<Button variant="ghost" size="compact" leadingIcon={Plus} onClick={() => setAdding(true)}>
						Add fallback
					</Button>
				)
			}
		/>
	);
}

function RoleRow({ route, editing }: { route: RoleRoute; editing: Editing }) {
	const editor = useEditor(
		{ primary: route.primary, fallbacks: route.fallbacks },
		draft =>
			saveRouting(editing.cwd, {
				kind: "role",
				role: route.role,
				...(draft.primary !== null && draft.primary !== route.primary && { primary: draft.primary }),
				// An unchanged inherited chain stays inherited rather than becoming a copy.
				...(JSON.stringify(draft.fallbacks) !== JSON.stringify(route.fallbacks) && { fallbacks: draft.fallbacks }),
			}),
		editing.saved,
	);
	const { draft } = editor;
	const viewing = editor.state.phase === "viewing";
	const inherited = route.inheritsDefault && JSON.stringify(draft.fallbacks) === JSON.stringify(route.fallbacks);
	return (
		<tr className="border-t border-border align-baseline">
			<th scope="row" className="py-2 pr-6 text-left font-medium">
				{route.role}
			</th>
			<td className="whitespace-nowrap py-2 pr-6">
				{viewing ? (
					route.primary ? (
						<Model selector={route.primary} />
					) : (
						<span className="text-muted-foreground">Not set</span>
					)
				) : (
					<SelectorPicker value={draft.primary} catalog={editing.catalog} label={`${route.role} model`} onPick={primary => editor.change({ ...draft, primary })} />
				)}
			</td>
			<td className="space-y-1 py-2 pr-4">
				{viewing ? <Chain fallbacks={route.fallbacks} /> : <ChainEditor chain={draft.fallbacks} catalog={editing.catalog} onChange={fallbacks => editor.change({ ...draft, fallbacks })} />}
				{inherited && <p className="text-xs text-muted-foreground">The default role's chain{viewing ? "" : ". Changing it gives this role its own."}</p>}
				{!viewing && route.role !== "default" && draft.fallbacks.length === 0 && (
					<p className="text-xs text-muted-foreground">With no fallbacks of its own, the role walks the default role's chain.</p>
				)}
				<SaveError editor={editor} />
			</td>
			<td className="py-2 text-right align-top">
				<EditBar editor={editor} label={`${route.role} role`} />
			</td>
		</tr>
	);
}

function ModelChainRow({ chain, editing }: { chain: ModelChain; editing: Editing }) {
	const editor = useEditor(chain.fallbacks, fallbacks => saveRouting(editing.cwd, { kind: "model-chain", key: chain.key, fallbacks }), editing.saved);
	return (
		<tr className="border-t border-border align-baseline">
			<th scope="row" className="py-2 pr-6 text-left font-mono text-xs font-medium">
				{chain.key}
			</th>
			<td className="space-y-1 py-2 pr-4">
				{editor.state.phase === "viewing" ? (
					<Chain fallbacks={chain.fallbacks} />
				) : (
					<ChainEditor chain={editor.draft} catalog={editing.catalog} onChange={editor.change} />
				)}
				<SaveError editor={editor} />
			</td>
			<td className="py-2 text-right align-top">
				<EditBar editor={editor} label={`chain for ${chain.key}`} />
			</td>
		</tr>
	);
}

/** A number typed as text, so the field can be cleared while typing; only a finite number reaches `onChange`. */
function NumberField({ value, id, onChange }: { value: number; id: string; onChange: (value: number) => void }) {
	const [text, setText] = useState(String(value));
	return (
		<input
			type="number"
			inputMode="numeric"
			id={id}
			className={cn(FIELD, "w-28 tabular-nums")}
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

function RetrySection({ routing, editing }: { routing: ModelRouting; editing: Editing }) {
	const editor = useEditor(
		routing.retry,
		draft =>
			saveRouting(editing.cwd, {
				kind: "retry",
				values: Object.fromEntries(Object.entries(draft).filter(([key, value]) => routing.retry[key as keyof RetrySettings] !== value)),
			}),
		editing.saved,
	);
	const set = (key: keyof RetrySettings, value: boolean | number | string): void => editor.change({ ...editor.draft, [key]: value });
	return (
		<Section title="Retry and fallback" actions={<EditBar editor={editor} label="retry and fallback" />}>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 text-sm">
				{RETRY_ROWS.map(([key, label, format, unit]) => {
					const value = editor.draft[key];
					const choices = routing.retryChoices[key];
					const id = `retry-${key}`;
					let field: ReactNode;
					if (editor.state.phase === "viewing") field = format(routing.retry[key]);
					else if (typeof value === "boolean") {
						field = <input type="checkbox" id={id} className="size-4 align-middle accent-current" checked={value} onChange={event => set(key, event.target.checked)} />;
					} else if (typeof value === "number") {
						field = (
							<span className="inline-flex items-center gap-1.5">
								<NumberField value={value} id={id} onChange={next => set(key, next)} />
								{unit && <span className="text-xs text-muted-foreground">{unit}</span>}
							</span>
						);
					} else {
						field = (
							<select id={id} className={FIELD} value={value} onChange={event => set(key, event.target.value)}>
								{(choices ?? [value]).map(choice => (
									<option key={choice} value={choice}>
										{choice}
									</option>
								))}
							</select>
						);
					}
					return (
						<div key={key} className="contents">
							<dt className="text-muted-foreground" title={`retry.${key}`}>
								{editor.state.phase === "viewing" ? label : <label htmlFor={id}>{label}</label>}
							</dt>
							<dd className="tabular-nums">{field}</dd>
						</div>
					);
				})}
			</dl>
			<SaveError editor={editor} />
		</Section>
	);
}

function ProviderPicker({ providers, onPick }: { providers: string[]; onPick: (provider: string) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" leadingIcon={Plus} active={open} disabled={providers.length === 0}>
					Add provider
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 p-0">
				<Command>
					<CommandInput aria-label="Search providers" placeholder="Search providers…" />
					<CommandList>
						<CommandEmpty>No provider matches.</CommandEmpty>
						<CommandGroup>
							{providers.map(provider => (
								<CommandItem
									key={provider}
									value={provider}
									onSelect={() => {
										setOpen(false);
										onPick(provider);
									}}
								>
									<OrgIcon org={providerOrg(provider)} />
									{provider}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function ProviderOrderSection({ order, editing }: { order: string[]; editing: Editing }) {
	const editor = useEditor(order, providers => saveRouting(editing.cwd, { kind: "provider-order", providers }), editing.saved);
	const { catalog } = editing;
	const unlisted = catalog.phase === "loaded" ? catalog.byProvider.map(([provider]) => provider).filter(provider => !editor.draft.includes(provider)) : [];
	const row = (provider: string): ReactNode => (
		<span className="flex items-center gap-2">
			<OrgIcon org={providerOrg(provider)} />
			{provider}
		</span>
	);
	return (
		<Section title="Provider order" actions={<EditBar editor={editor} label="provider order" />}>
			{editor.state.phase !== "viewing" ? (
				<OrderedList
					items={editor.draft}
					label={provider => provider}
					onChange={editor.change}
					render={row}
					add={<ProviderPicker providers={unlisted} onPick={provider => editor.change([...editor.draft, provider])} />}
				/>
			) : order.length === 0 ? (
				<p className="text-sm text-muted-foreground">Not set. omp picks among providers that serve a model by its own order.</p>
			) : (
				<ol className="space-y-2 text-sm">
					{order.map((provider, index) => (
						<li key={provider} className="flex items-center gap-2">
							<span className="w-3 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
							{row(provider)}
						</li>
					))}
				</ol>
			)}
			<SaveError editor={editor} />
		</Section>
	);
}

/** Roles, per-model chains, and provider order: which model a session gets and where its fallbacks are served from. */
function RolesTab({ routing, configPath, editing }: { routing: ModelRouting; configPath: string | undefined; editing: Editing }) {
	return (
		<>
			<Section title="Model roles" meta={configPath && `Saved to ${configPath}`}>
				{routing.roles.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No roles are set. omp uses its own defaults until <code>modelRoles</code> names a model.
					</p>
				) : (
					<table className="w-full text-sm">
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th scope="col" className="pb-2 pr-6 font-medium">
									Role
								</th>
								<th scope="col" className="pb-2 pr-6 font-medium">
									Model
								</th>
								<th scope="col" className="pb-2 font-medium">
									Fallbacks, in order
								</th>
								<th scope="col" className="pb-2">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{routing.roles.map(route => (
								<RoleRow key={route.role} route={route} editing={editing} />
							))}
						</tbody>
					</table>
				)}
			</Section>
			{routing.modelChains.length > 0 && (
				<Section title="Chains for a model" meta="These apply whenever the model is active, whatever its role.">
					<table className="w-full text-sm">
						<tbody>
							{routing.modelChains.map(chain => (
								<ModelChainRow key={chain.key} chain={chain} editing={editing} />
							))}
						</tbody>
					</table>
				</Section>
			)}
			<ProviderOrderSection order={routing.modelProviderOrder} editing={editing} />
		</>
	);
}

function FileView({ file, editing }: { file: OmpFile; editing: Editing }) {
	const { body } = file;
	const editor = useEditor(
		body.state === "read" ? body.text : "",
		text => saveFile(editing.cwd, { path: file.path, text, baseHash: body.state === "read" ? body.hash : null }),
		editing.saved,
	);
	const viewing = editor.state.phase === "viewing";
	const conflict = editor.state.phase === "editing" && editor.state.conflict;
	return (
		<div className="flex min-w-0 flex-col gap-2 self-start md:sticky md:top-6" role="region" aria-label={file.pathDisplay}>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
					<span className="font-mono text-foreground">{file.pathDisplay}</span>
					{body.state === "read" && (
						<>
							<span className="tabular-nums">{body.size < 1024 ? `${body.size} B` : `${(body.size / 1024).toFixed(1)} KB`}</span>
							<span>Changed {new Date(body.modifiedAt).toLocaleString()}</span>
						</>
					)}
				</p>
				{body.state !== "unreadable" && <EditBar editor={editor} label={file.pathDisplay} start={body.state === "missing" ? "Create" : "Edit"} />}
			</div>
			{!viewing ? (
				<>
					<textarea
						aria-label={`Contents of ${file.pathDisplay}`}
						spellCheck={false}
						autoFocus
						readOnly={editor.state.phase === "saving"}
						value={editor.draft}
						onChange={event => editor.change(event.target.value)}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === "s") {
								event.preventDefault();
								if (editor.dirty) void editor.submit();
							}
						}}
						className="h-[70vh] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<SaveError editor={editor} />
						{conflict && (
							<Button
								variant="secondary"
								size="compact"
								onClick={() => {
									editor.cancel();
									void editing.reload();
								}}
							>
								Discard my edits and load the file from disk
							</Button>
						)}
					</div>
				</>
			) : body.state === "read" ? (
				<pre
					tabIndex={0}
					className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{body.text || <span className="text-muted-foreground">The file is empty.</span>}
				</pre>
			) : (
				<p
					className={cn(
						"rounded-md border border-dashed border-border px-3 py-6 text-center text-sm",
						body.state === "unreadable" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
					)}
				>
					{body.state === "missing" ? "This file does not exist yet. omp reads it from this path once you create it." : `Cannot read this file: ${body.error}`}
				</p>
			)}
		</div>
	);
}

function Files({ files, editing }: { files: OmpFile[]; editing: Editing }) {
	const groups = fileGroups(files);
	const [selected, setSelected] = useState<string | null>(null);
	const open = files.find(file => file.path === selected) ?? groups[0]?.[1][0];
	if (!open) return <p className="text-sm text-muted-foreground">omp found no files.</p>;
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav aria-label="omp files" className="space-y-4">
				{groups.map(([kind, group]) => (
					<div key={kind} className="space-y-1">
						<h4 className="px-2 text-xs font-medium text-muted-foreground">{FILE_KIND_LABELS[kind]}</h4>
						<ul>
							{group.map(file => {
								const parts = file.path.split("/");
								// A skill's file is always SKILL.md; its directory names it.
								const name = parts.at(-1) === "SKILL.md" ? parts.at(-2) : parts.at(-1);
								return (
									<li key={file.path}>
										<button
											type="button"
											aria-current={file === open ? "true" : undefined}
											title={file.pathDisplay}
											onClick={() => setSelected(file.path)}
											className={cn(
												"flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
												file === open && "bg-muted font-medium",
											)}
										>
											<span className={cn("truncate", file.body.state !== "read" && "text-muted-foreground")}>{name}</span>
											<span className="ml-auto shrink-0 text-xs text-muted-foreground">
												{file.body.state === "missing" ? "missing" : file.scope === "project" ? "project" : ""}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				))}
			</nav>
			<FileView key={open.path} file={open} editing={editing} />
		</div>
	);
}

function WorkspacePicker({ cwd, workspaces }: { cwd: string | null; workspaces: Workspace[] }) {
	const [open, setOpen] = useState(false);
	const label = cwd === null ? "User files only" : (workspaces.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd);
	const pick = (next: string | null): void => {
		setOpen(false);
		location.hash = hashForSettings(next);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="compact" leadingIcon={FolderOpen} trailingIcon={ChevronsUpDown} aria-label={`Workspace: ${label}`} active={open}>
					<span className="max-w-64 truncate">{label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
				<Command>
					<CommandInput aria-label="Search workspaces" placeholder="Search workspaces…" />
					<CommandList>
						<CommandEmpty>No workspace matches.</CommandEmpty>
						<CommandGroup>
							<CommandItem value="User files only" onSelect={() => pick(null)}>
								User files only
								<Check className={cn("ml-auto", cwd === null ? "opacity-100" : "opacity-0")} />
							</CommandItem>
						</CommandGroup>
						<CommandGroup heading="Workspaces">
							{workspaces.map(workspace => (
								<CommandItem key={workspace.cwd} value={workspace.cwd} onSelect={() => pick(workspace.cwd)}>
									<span className="truncate">{workspace.cwdDisplay}</span>
									<Check className={cn("ml-auto", workspace.cwd === cwd ? "opacity-100" : "opacity-0")} />
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

const THEME_OPTIONS: Record<Theme, [string, LucideIcon]> = {
	system: ["System", Monitor],
	light: ["Light", Sun],
	dark: ["Dark", Moon],
};

/** The dashboard's own look, kept in this browser rather than in omp's files. */
function AppearanceTab() {
	const [theme, setTheme] = useTheme();
	return (
		<Section title="Theme" meta="System follows your computer's light or dark setting. Saved in this browser.">
			<RadioGroup
				aria-label="Theme"
				value={theme}
				onValueChange={value => setTheme(THEMES.find(option => option === value) ?? theme)}
				className="flex gap-2"
			>
				{THEMES.map(option => {
					const [label, Icon] = THEME_OPTIONS[option];
					return (
						<Radio.Root
							key={option}
							value={option}
							className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md pr-3 pl-2 text-[12px] text-muted-foreground shadow-[0_0_0_1px_var(--border)] outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-active data-[checked]:text-foreground"
						>
							<Icon aria-hidden className="size-3.5" />
							{label}
						</Radio.Root>
					);
				})}
			</RadioGroup>
		</Section>
	);
}

const SETTINGS_TABS = [
	{ value: "roles", label: "Model roles & provider order", icon: Route },
	{ value: "retry", label: "Retry and fallback", icon: RotateCcw },
	{ value: "files", label: "Files", icon: FileText },
	{ value: "appearance", label: "Appearance", icon: Palette },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

const PANEL = "space-y-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background data-[state=inactive]:hidden";

/** What the omp tabs show: their content once omp's settings are read, else why they are empty. */
function ompPanels(load: Load, cwd: string | null, editing: Editing): Record<Exclude<SettingsTab, "appearance">, ReactNode> {
	if (load.phase !== "loaded") {
		const note =
			load.phase === "loading" ? (
				<p className="text-sm text-muted-foreground">Reading omp's settings…</p>
			) : (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Cannot read omp's settings: {load.error}
				</p>
			);
		return { roles: note, retry: note, files: note };
	}
	const { routing, files } = load.settings;
	const filesPanel = <Files key={cwd ?? ""} files={files} editing={editing} />;
	if ("error" in routing) {
		const alert = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				omp cannot load its settings: {routing.error}
			</p>
		);
		return { roles: alert, retry: alert, files: filesPanel };
	}
	const configPath = files.find(file => file.kind === "settings" && file.scope === "user" && file.path.endsWith("/config.yml"))?.pathDisplay;
	return {
		roles: <RolesTab routing={routing} configPath={configPath} editing={editing} />,
		retry: <RetrySection routing={routing} editing={editing} />,
		files: filesPanel,
	};
}

/** omp's model routing and the files it reads, for one workspace or for the user only, each editable in place. */
export function SettingsPage({ cwd, workspaces }: { cwd: string | null; workspaces: Workspace[] }) {
	const [load, setLoad] = useState<Load>({ phase: "loading" });
	const [tab, setTab] = useState<SettingsTab>("roles");
	const [catalog, setCatalog] = useState<Catalog>({ phase: "loading" });
	// A save answered after the user switched workspace must not replace the new workspace's settings.
	const currentCwd = useRef(cwd);
	currentCwd.current = cwd;

	useEffect(() => {
		loadModels().then(
			models => {
				const byProvider = new Map<string, CatalogModel[]>();
				for (const model of models) byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
				setCatalog({ phase: "loaded", bySelector: new Map(models.map(model => [model.selector, model])), byProvider: [...byProvider] });
			},
			(err: unknown) => setCatalog({ phase: "failed", error: `Cannot list omp's models: ${errorText(err)}` }),
		);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		setLoad({ phase: "loading" });
		loadSettings(cwd, controller.signal).then(
			settings => setLoad({ phase: "loaded", settings }),
			(err: unknown) => {
				if (!controller.signal.aborted) setLoad({ phase: "failed", error: errorText(err) });
			},
		);
		return () => controller.abort();
	}, [cwd]);

	const saved = (settings: OmpSettings): void => {
		if (settings.cwd === currentCwd.current) setLoad({ phase: "loaded", settings });
	};
	const editing: Editing = {
		cwd,
		catalog,
		saved,
		reload: () =>
			loadSettings(cwd, new AbortController().signal).then(saved, (err: unknown) => setLoad({ phase: "failed", error: errorText(err) })),
	};

	const panels: Record<SettingsTab, ReactNode> = { ...ompPanels(load, cwd, editing), appearance: <AppearanceTab /> };
	// Panels stay mounted so an unsaved draft survives switching tabs; PANEL hides the inactive ones.
	const body = (
		<Tabs value={tab} onValueChange={value => setTab(SETTINGS_TABS.find(option => option.value === value)?.value ?? tab)} className="space-y-6">
			<SizeProvider size="compact">
				<TabsList aria-label="Settings">
					{SETTINGS_TABS.map(({ value, label, icon }) => (
						<TabItem key={value} value={value} label={label} icon={icon} />
					))}
				</TabsList>
			</SizeProvider>
			{SETTINGS_TABS.map(({ value }) => (
				<TabPanel key={value} value={value} forceMount className={PANEL}>
					{panels[value]}
				</TabPanel>
			))}
		</Tabs>
	);

	return (
		<div className="flex h-svh min-h-0 flex-1 flex-col">
			<Header
				title="Settings"
				meta={cwd === null ? "omp's model routing and your files" : "omp's model routing and files, as a session in this workspace loads them"}
			>
				<WorkspacePicker cwd={cwd} workspaces={workspaces} />
			</Header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
			</div>
		</div>
	);
}
