/**
 * Settings › omp memory: the backend omp remembers with and Auto-learn, what a new session in the workspace gets, and
 * the store itself in its own shape, files in a rail like Files' and rows in a list, each edited or forgotten in place.
 */
import { IconChevronRight, IconLock } from "central-icons";
import { type ReactNode, useId, useState } from "react";
import type { AgentSettingOption, AgentSettingRow, AgentSettings } from "../../../src/shared/agent-settings";
import { everyWord } from "../../../src/shared/every-word";
import type { OmpFile, OmpSettings } from "../../../src/shared/models";
import {
	OMP_MEMORY_SETTINGS,
	type OmpMemory,
	type OmpMemoryClear,
	type OmpMemoryEntry,
	type OmpMemoryEntryEdit,
	type OmpMemoryFile,
	type OmpMemoryFileGroup,
	type OmpMemoryRows,
	type OmpMemoryStore,
} from "../../../src/shared/omp-memory";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ompMemoryUrl, putJson } from "../../api";
import { type Editable, useEditableRead } from "../../editable-read";
import { formatValue, ompSettingsFiles, valueOf } from "../../omp-settings";
import { type InlineConfirm, useInlineConfirm } from "../../use-inline-confirm";
import { Age } from "../age";
import { SearchField } from "../search-field";
import { ToggleSwitch } from "../toggle-switch";
import { type Editing, ErrorText, FileLink, LayerNotes, Section, saveAgentSetting, useSaving, writeOrReload } from "./editor";
import { FileRail, FileView } from "./files-tab";

/** What the section's parts share: the page's settings to save through, the memory read, and the Files link. */
interface MemoryContext {
	editing: Editing;
	memory: Editable<OmpMemory>;
	/** The workspace's own settings file, which a workspace value comes from. */
	projectFile: OmpFile | undefined;
	onOpenFile: (path: string) => void;
}

/** The rows of Settings › omp settings the bar edits, and the backends omp offers. */
interface BarRows {
	backend: AgentSettingRow;
	options: AgentSettingOption[];
	autolearn: AgentSettingRow;
	autoContinue: AgentSettingRow;
}

/** The bar's rows from omp's settings, `null` when this omp lists any of them otherwise or not at all. */
function barRows({ tabs }: AgentSettings): BarRows | null {
	const rows = new Map(tabs.flatMap(tab => tab.groups.flatMap(group => group.rows)).map(row => [row.id, row]));
	const backend = rows.get(OMP_MEMORY_SETTINGS.backend);
	const autolearn = rows.get(OMP_MEMORY_SETTINGS.autolearn);
	const autoContinue = rows.get(OMP_MEMORY_SETTINGS.autoContinue);
	if (backend?.control.kind !== "select" || autolearn?.control.kind !== "toggle" || autoContinue?.control.kind !== "toggle") return null;
	return { backend, options: backend.control.options, autolearn, autoContinue };
}

/** Why a bar row's control is locked or overridden, as Settings › omp settings says it. */
function RowNotes({ row, context }: { row: AgentSettingRow; context: MemoryContext }) {
	return (
		<LayerNotes
			workspace={row.workspace !== undefined}
			env={row.env}
			yourValue={formatValue(row, row.user ?? row.default)}
			projectFile={context.projectFile}
			onOpenFile={context.onOpenFile}
		/>
	);
}

/** An on-off row of the bar: its label, its switch, and omp's description of it. */
function SwitchRow({ row, busy, onSave, context }: { row: AgentSettingRow; busy: boolean; onSave: (value: boolean) => void; context: MemoryContext }) {
	const labelId = useId();
	return (
		<div className="space-y-1">
			<div className="flex items-center gap-2">
				<span id={labelId} className="text-sm font-medium">
					{row.label}
				</span>
				<ToggleSwitch aria-labelledby={labelId} checked={valueOf(row) === true} disabled={busy || row.workspace !== undefined} onCheckedChange={onSave} />
				{row.workspace !== undefined && <IconLock className="size-3.5 text-muted-foreground" />}
			</div>
			<p className="text-xs text-muted-foreground">{row.description}</p>
			<RowNotes row={row} context={context} />
		</div>
	);
}

/** The backend picker and Auto-learn: omp's own rows for them, saved to your `config.yml` as Settings › omp settings saves them. */
function MemoryBar({ rows, configPath, context }: { rows: BarRows; configPath: string | undefined; context: MemoryContext }) {
	const saving = useSaving<string>();
	const backendLabel = useId();
	const hintId = useId();
	const busy = saving.saving !== null;
	const { backend, options, autolearn, autoContinue } = rows;
	const save = (row: AgentSettingRow, value: unknown): void =>
		saving.run(row.id, () => saveAgentSetting(context.editing, { id: row.id, value, expected: row.user ?? null }));
	const value = valueOf(backend);
	const picked = options.find(option => option.value === value);
	return (
		<div aria-busy={busy} className={cn("space-y-3 rounded-md border border-border px-4 py-3 transition-opacity motion-reduce:transition-none", busy && "opacity-60")}>
			<div className="space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<span id={backendLabel} className="text-sm font-medium">
						{backend.label}
					</span>
					<Select value={value} disabled={busy || backend.workspace !== undefined} onValueChange={next => next !== value && save(backend, next)}>
						<SelectTrigger aria-labelledby={backendLabel} aria-describedby={picked?.description ? hintId : undefined} className="w-40">
							<SelectValue>{(shown: unknown) => formatValue(backend, shown)}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{options.map(option => (
								<SelectItem key={String(option.value)} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{backend.workspace !== undefined && <IconLock className="size-3.5 text-muted-foreground" />}
					{configPath && <p className="ml-auto text-xs text-muted-foreground">Saved to {configPath}</p>}
				</div>
				{picked?.description && (
					<p id={hintId} className="text-xs text-muted-foreground">
						{picked.label}: {picked.description}
					</p>
				)}
				<RowNotes row={backend} context={context} />
			</div>
			<SwitchRow row={autolearn} busy={busy} onSave={checked => save(autolearn, checked)} context={context} />
			{valueOf(autolearn) === true && (
				<div className="border-l border-border pl-3">
					<SwitchRow row={autoContinue} busy={busy} onSave={checked => save(autoContinue, checked)} context={context} />
				</div>
			)}
			{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
		</div>
	);
}

/** The memory block a new session's system prompt gets, folded, with its size in tokens at about four characters each. */
function SessionPreview({ preview }: { preview: OmpMemory["preview"] }) {
	const [open, setOpen] = useState(false);
	if (!preview) return <p className="text-sm text-muted-foreground">A new session here gets no memory in its prompt yet.</p>;
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
			<CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				<IconChevronRight className={cn("size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				<span className="font-medium">What a new session gets</span>
				<span className="text-xs text-muted-foreground tabular-nums">about {Math.ceil(preview.text.length / 4).toLocaleString()} tokens</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="space-y-2 px-3 pb-3">
				{preview.partial && <p className="text-xs text-muted-foreground">A running session also gets memories recalled for each prompt, which only it can show.</p>}
				<pre
					tabIndex={0}
					className="max-h-[50vh] overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{preview.text}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}

const GROUP_LABELS: Record<OmpMemoryFileGroup, string> = {
	lessons: "Lessons",
	summary: "Summary",
	skills: "Skills",
	rollouts: "Session summaries",
	decisions: "Decisions",
};

/** A file backend's files in a folder per group, and the one picked, the first by default, viewed and edited in place. */
function MemoryFiles({ files, cwd, context, empty }: { files: OmpMemoryFile[]; cwd: string; context: MemoryContext; empty: string }) {
	const [selected, setSelected] = useState<string | null>(null);
	const open = files.find(file => file.path === selected) ?? files[0];
	if (!open) {
		return <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
	}
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<FileRail label="omp memory files" filtered={files.length > 8} files={files} pathOf={file => `${GROUP_LABELS[file.group]}/${file.name}`} open={open} onSelect={setSelected}>
				{(_file, name) => <span className="truncate">{name}</span>}
			</FileRail>
			<FileView key={open.path} file={open} saver={{ save: edit => putJson<OmpMemory>(ompMemoryUrl("/file", cwd), edit), write: context.memory.write, reload: context.memory.reload }} />
		</div>
	);
}

const KIND_LABELS: Record<OmpMemoryEntry["kind"], string> = { working: "Working", episodic: "Episodic", fact: "Fact", remote: "Hindsight" };

/** One entry: its text, which Edit turns into a field that ⌘Enter saves and Escape reverts, and the actions omp allows on it. */
function EntryRow({ entry, cwd, context, confirm }: { entry: OmpMemoryEntry; cwd: string; context: MemoryContext; confirm: InlineConfirm }) {
	const contentId = useId();
	// The text being edited, with the content it started from: once the row holds other content, after a save or a
	// re-read on a conflict, the draft no longer shows.
	const [editing, setEditing] = useState<{ from: string; text: string } | null>(null);
	const draft = editing?.from === entry.content ? editing.text : null;
	const saving = useSaving<OmpMemoryEntryEdit["op"]>();
	const send = (edit: OmpMemoryEntryEdit): void => saving.run(edit.op, () => writeOrReload(context.memory, () => putJson<OmpMemory>(ompMemoryUrl("/entry", cwd), edit)));
	const at = entry.at === null ? Number.NaN : Date.parse(entry.at);
	const busy = saving.saving !== null;
	const key = `${entry.bank}:${entry.id}`;
	const row = { bank: entry.bank, id: entry.id, expected: entry.content };
	const save = (): void => {
		if (draft === null || draft.trim() === "" || draft === entry.content) {
			setEditing(null);
			return;
		}
		send({ op: "update", ...row, content: draft });
	};
	return (
		<li aria-busy={busy} className={cn("flex items-start gap-4 py-2.5 transition-opacity motion-reduce:transition-none", busy && "opacity-60")}>
			<div className="min-w-0 flex-1 space-y-1">
				{draft === null ? (
					<p id={contentId} className="text-sm break-words whitespace-pre-wrap">
						{entry.content}
					</p>
				) : (
					<textarea
						aria-label="Memory text"
						autoFocus
						readOnly={busy}
						value={draft}
						rows={Math.min(8, draft.split("\n").length + 1)}
						onChange={event => setEditing({ from: entry.content, text: event.target.value })}
						onKeyDown={event => {
							if (event.key === "Escape") {
								event.preventDefault();
								setEditing(null);
							} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								save();
							}
						}}
						className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				)}
				<p className="flex gap-2 text-xs text-muted-foreground">
					<span>{KIND_LABELS[entry.kind]}</span>
					{Number.isFinite(at) && <Age at={at} compact exact className="tabular-nums" />}
				</p>
				{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{draft !== null ? (
					<>
						<Button variant="ghost" size="compact" disabled={busy} onClick={() => setEditing(null)}>
							Cancel
						</Button>
						<Button variant="primary" size="compact" disabled={busy} loading={saving.saving === "update"} onClick={save}>
							Save
						</Button>
					</>
				) : (
					<>
						{entry.ops.includes("update") && (
							<Button variant="ghost" size="compact" disabled={busy} aria-describedby={contentId} onClick={() => setEditing({ from: entry.content, text: entry.content })}>
								Edit
							</Button>
						)}
						{entry.ops.includes("forget") && (
							<Button
								variant="destructive-outline"
								size="compact"
								disabled={busy}
								loading={saving.saving === "forget"}
								aria-describedby={contentId}
								{...confirm.props(`forget:${key}`, () => send({ op: "forget", ...row }))}
							>
								{confirm.isArmed(`forget:${key}`) ? "Confirm forget?" : "Forget"}
							</Button>
						)}
						{entry.ops.includes("retire") && (
							<Tooltip content="Recall stops using it; the row stays in the store">
								<Button
									variant="destructive-outline"
									size="compact"
									disabled={busy}
									loading={saving.saving === "retire"}
									aria-describedby={contentId}
									{...confirm.props(`retire:${key}`, () => send({ op: "retire", ...row }))}
								>
									{confirm.isArmed(`retire:${key}`) ? "Confirm retire?" : "Retire"}
								</Button>
							</Tooltip>
						)}
						{entry.ops.length === 0 && <span className="text-xs text-muted-foreground">Read-only</span>}
					</>
				)}
			</div>
		</li>
	);
}

/** A row backend's entries, newest first, narrowed by a filter, with a count per kind. */
function MemoryEntries({ rows, cwd, context, confirm, empty }: { rows: OmpMemoryRows; cwd: string; context: MemoryContext; confirm: InlineConfirm; empty: string }) {
	const [query, setQuery] = useState("");
	if ("error" in rows) return <ErrorText>Cannot read the memories: {rows.error}</ErrorText>;
	if (rows.entries.length === 0) {
		return <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
	}
	const counts = Map.groupBy(rows.entries, entry => entry.kind);
	const matches = everyWord(query);
	const shown = rows.entries.filter(entry => matches(entry.content));
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<SearchField label="Filter memories" placeholder="Filter" query={query} onQuery={setQuery} className="min-w-0 flex-1" />
				<p className="text-xs text-muted-foreground tabular-nums">
					{[...counts].map(([kind, entries]) => `${KIND_LABELS[kind]} ${entries.length.toLocaleString()}`).join(" · ")}
				</p>
				{rows.truncated && <p className="text-xs text-muted-foreground tabular-nums">Showing the newest {rows.entries.length.toLocaleString()}</p>}
			</div>
			{shown.length === 0 ? (
				<p className="text-sm text-muted-foreground">No memory matches.</p>
			) : (
				<ul className="divide-y divide-border">
					{shown.map(entry => (
						<EntryRow key={`${entry.bank}:${entry.id}`} entry={entry} cwd={cwd} context={context} confirm={confirm} />
					))}
				</ul>
			)}
		</div>
	);
}

/** What Forget everything sends, and what it removes; `null` when the store has nothing this page can forget at once. */
function clearOf(store: OmpMemoryStore): { edit: OmpMemoryClear; removes: string } | null {
	switch (store.backend) {
		case "local":
			return { edit: { backend: "local" }, removes: "Forget everything removes the lessons, the summary, skills, and session summaries for this folder." };
		case "sharpshooter":
			return { edit: { backend: "sharpshooter" }, removes: "Forget everything removes the decision files for this folder." };
		case "mnemopi": {
			const own = store.banks.filter(bank => bank !== store.sharedBank);
			if (own.length === 0) return null;
			const kept = store.sharedBank === null ? "" : ` ${store.sharedBank}, shared with other folders, stays.`;
			return { edit: { backend: "mnemopi" }, removes: `Forget everything removes every memory in ${own.join(", ")}.${kept}` };
		}
		case "off":
		case "hindsight":
			return null;
	}
}

/** Rebuild summary for Local, and Forget everything for the stores the page can clear, each armed before it runs. */
function StoreActions({
	local,
	saving,
	confirm,
	onRebuild,
	onClear,
}: {
	local: boolean;
	saving: "rebuild" | "clear" | null;
	confirm: InlineConfirm;
	onRebuild: () => void;
	onClear: () => void;
}) {
	const busy = saving !== null;
	return (
		<div className="flex shrink-0 items-center gap-2">
			{local && (
				<Tooltip content="It runs when the next session here starts">
					<Button variant="secondary" size="compact" disabled={busy} loading={saving === "rebuild"} onClick={onRebuild}>
						Rebuild summary
					</Button>
				</Tooltip>
			)}
			<Button variant="destructive-outline" size="compact" disabled={busy} loading={saving === "clear"} {...confirm.props("clear", onClear)}>
				{confirm.isArmed("clear") ? "Confirm forget everything?" : "Forget everything"}
			</Button>
		</div>
	);
}

/** The store of the backend in effect, in its own shape. `options` are the backends the bar offers, which Off lists. */
function Store({ store, options, cwd, context }: { store: OmpMemoryStore; options: AgentSettingOption[]; cwd: string; context: MemoryContext }) {
	const confirm = useInlineConfirm(`omp-memory:${cwd}`);
	const saving = useSaving<"rebuild" | "clear">();
	let body: ReactNode;
	let meta: ReactNode = null;
	switch (store.backend) {
		case "off":
			return (
				<div className="space-y-3 rounded-md border border-dashed border-border px-3 py-6 text-sm">
					<div className="space-y-1 text-center">
						<p className="font-medium">omp remembers nothing between sessions here.</p>
						<p className="text-muted-foreground">Pick a backend above to start:</p>
					</div>
					<ul className="mx-auto max-w-lg space-y-1 text-muted-foreground">
						{options
							.filter(option => option.value !== "off")
							.map(option => (
								<li key={String(option.value)}>
									<span className="font-medium text-foreground">{option.label}</span>
									{option.description && `: ${option.description}`}
								</li>
							))}
					</ul>
				</div>
			);
		case "local":
			body = <MemoryFiles files={store.files} cwd={cwd} context={context} empty="Nothing yet. omp summarizes a session here once it has been idle for a while." />;
			break;
		case "sharpshooter":
			meta = store.queued > 0 && <span className="tabular-nums">{store.queued.toLocaleString()} waiting to be folded in</span>;
			body = <MemoryFiles files={store.files} cwd={cwd} context={context} empty="No decisions yet." />;
			break;
		case "mnemopi":
			meta = <span>Banks: {store.banks.join(", ")}</span>;
			body = <MemoryEntries rows={store} cwd={cwd} context={context} confirm={confirm} empty="Nothing retained yet." />;
			break;
		case "hindsight":
			meta = <span>Bank: {store.bank}. Read-only here; Hindsight keeps these on its server.</span>;
			body = <MemoryEntries rows={store} cwd={cwd} context={context} confirm={confirm} empty="Nothing retained yet." />;
			break;
	}
	const clear = clearOf(store);
	const send = (key: "rebuild" | "clear", body: OmpMemoryClear | Record<string, never>): void =>
		saving.run(key, () => writeOrReload(context.memory, () => putJson<OmpMemory>(ompMemoryUrl(`/${key}`, cwd), body)));
	const shared = store.backend === "mnemopi" ? store.sharedBank !== null : store.backend === "hindsight" && store.shared;
	return (
		<Section
			title="Stored memory"
			meta={
				(meta || clear) && (
					<>
						{meta && <span className="block">{meta}</span>}
						{clear && <span className="block">{clear.removes}</span>}
					</>
				)
			}
			actions={
				clear && <StoreActions local={store.backend === "local"} saving={saving.saving} confirm={confirm} onRebuild={() => send("rebuild", {})} onClear={() => send("clear", clear.edit)} />
			}
		>
			{shared && (
				<p className="text-xs text-warning-foreground">
					{store.backend === "mnemopi"
						? `Every folder reads ${store.sharedBank} too. Editing or forgetting one of its memories changes it everywhere.`
						: "Every folder reads this bank."}
				</p>
			)}
			{body}
			{saving.error && <ErrorText>{saving.error}</ErrorText>}
		</Section>
	);
}

/** A read the section cannot show, with a link to fix `config.yml` in Files. */
function ReadError({ children, configFile, onOpenFile }: { children: ReactNode; configFile: OmpFile | undefined; onOpenFile: (path: string) => void }) {
	return (
		<div className="space-y-2">
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				{children}
			</p>
			{configFile && (
				<p className="text-sm text-muted-foreground">
					<FileLink file={configFile} onOpenFile={onOpenFile}>
						Fix config.yml in Files
					</FileLink>
				</p>
			)}
		</div>
	);
}

/**
 * The section: the bar from the page's settings, and the workspace's memory, read only while it shows. The memory reads
 * again whenever the page's settings change, so a save here or in another section shows at once.
 */
export function OmpMemoryTab({ active, settings, editing, onOpenFile }: { active: boolean; settings: OmpSettings; editing: Editing; onOpenFile: (path: string) => void }) {
	const { cwd } = editing;
	const memory = useEditableRead<OmpMemory>(active && cwd !== null ? ompMemoryUrl("", cwd) : null, settings);
	const { configFile, projectFile } = ompSettingsFiles(settings.files);
	const context: MemoryContext = { editing, memory, projectFile, onOpenFile };
	if ("error" in settings.agentSettings) {
		return (
			<ReadError configFile={configFile} onOpenFile={onOpenFile}>
				omp cannot load its settings: {settings.agentSettings.error}
			</ReadError>
		);
	}
	const rows = barRows(settings.agentSettings);
	if (!rows) return <ErrorText>This omp lists no memory backend or Auto-learn setting the page knows.</ErrorText>;
	let workspace: ReactNode;
	if (cwd === null) workspace = <p className="text-sm text-muted-foreground">Pick a workspace to see what omp remembers there.</p>;
	else if (memory.data !== null) {
		workspace = (
			<>
				<div className="space-y-2">
					<SessionPreview preview={memory.data.preview} />
					<p className="text-xs text-muted-foreground">Running sessions keep what they started with. New sessions see your changes.</p>
				</div>
				<Store store={memory.data.store} options={rows.options} cwd={cwd} context={context} />
			</>
		);
	} else if (memory.error !== null) {
		workspace = (
			<ReadError configFile={configFile} onOpenFile={onOpenFile}>
				Cannot read omp memory: {memory.error}
			</ReadError>
		);
	} else workspace = active && <p className="text-sm text-muted-foreground">Reading omp memory…</p>;
	return (
		<div className="space-y-8">
			<MemoryBar rows={rows} configPath={configFile?.pathDisplay} context={context} />
			{workspace}
		</div>
	);
}
