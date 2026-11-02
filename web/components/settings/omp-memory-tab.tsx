/**
 * Settings › omp memory: the backend omp remembers with and Auto-learn, what a new session in the workspace gets, and
 * the store itself in its own shape, files in the Files rail and rows in a list, each edited or forgotten in place.
 */
import { ChevronRight, Lock } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { errorText } from "../../../src/json";
import type { AgentSettingEdit } from "../../../src/shared/agent-settings";
import { everyWord } from "../../../src/shared/every-word";
import type { OmpFile, OmpSettings } from "../../../src/shared/models";
import type {
	OmpMemory,
	OmpMemoryBackendId,
	OmpMemoryBackendOption,
	OmpMemoryEntry,
	OmpMemoryEntryEdit,
	OmpMemoryFile,
	OmpMemoryFileGroup,
	OmpMemoryRows,
	OmpMemorySetting,
	OmpMemoryStore,
	OmpMemoryWorkspace,
} from "../../../src/shared/omp-memory";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ApiError, ompMemoryUrl, putJson, settingsUrl } from "../../api";
import { type Editable, useEditableRead } from "../../editable-read";
import { hashForSettings } from "../../routing";
import { type InlineConfirm, useInlineConfirm } from "../../use-inline-confirm";
import { Age } from "../age";
import { SearchField } from "../search-field";
import { ToggleSwitch } from "../toggle-switch";
import { type Editing, ErrorText, LINK, RAIL_BUTTON, Section } from "./editor";
import { FileView } from "./files-tab";

/** What the section's parts share: the page's settings to save through, the memory read, and the Files link. */
interface MemoryContext {
	editing: Editing;
	memory: Editable<OmpMemory>;
	/** The workspace's own settings file, which a workspace value comes from. */
	projectFile: OmpFile | undefined;
	onOpenFile: (path: string) => void;
}

/** One control's save at a time: which one is saving, and why the last one failed. */
function useSaving() {
	const [state, setState] = useState<{ saving: string | null; error: string | null }>({ saving: null, error: null });
	return {
		...state,
		run: (key: string, send: () => Promise<unknown>): void => {
			setState({ saving: key, error: null });
			send().then(
				() => setState({ saving: null, error: null }),
				(err: unknown) => setState({ saving: null, error: err instanceof ApiError && err.conflict ? "Changed since you opened it. This shows it as it is now." : errorText(err) }),
			);
		},
	};
}

function FileLink({ file, onOpenFile, children }: { file: OmpFile; onOpenFile: (path: string) => void; children: string }) {
	return (
		<a href={hashForSettings("files")} onClick={() => onOpenFile(file.path)} className={LINK}>
			{children}
		</a>
	);
}

/** Where a setting's value comes from, when it is not your own `config.yml`: the workspace, or an environment variable. */
function SourceNote<T>({ setting, format, context }: { setting: OmpMemorySetting<T>; format: (value: T) => string; context: MemoryContext }) {
	if (setting.source.layer === "env") {
		return (
			<p className="text-xs text-muted-foreground">
				<code className="font-mono">{setting.source.variable}</code> is set, and it overrides this value.
			</p>
		);
	}
	if (setting.source.layer !== "workspace") return null;
	return (
		<p className="text-xs text-muted-foreground">
			This workspace sets it.{" "}
			{context.projectFile && (
				<>
					<FileLink file={context.projectFile} onOpenFile={context.onOpenFile}>
						Open in Files
					</FileLink>
					.{" "}
				</>
			)}
			{setting.user !== null && `Your value: ${format(setting.user)}`}
		</p>
	);
}

const onOff = (value: boolean): string => (value ? "On" : "Off");

/** The backend picker and Auto-learn, saved to your `config.yml` through the page's settings like any omp setting. */
function MemoryBar({ data, configPath, context }: { data: OmpMemory; configPath: string | undefined; context: MemoryContext }) {
	const { editing } = context;
	const saving = useSaving();
	const backendLabel = useId();
	const hintId = useId();
	const autolearnLabel = useId();
	const continueLabel = useId();
	const { backend, autolearn } = data;
	const save = (key: string, id: string, setting: OmpMemorySetting<unknown>, value: unknown): void =>
		saving.run(key, async () => {
			try {
				await editing.write(() => putJson<OmpSettings>(settingsUrl("/agent", editing.cwd), { id, value, expected: setting.user } satisfies AgentSettingEdit));
			} catch (err) {
				if (err instanceof ApiError && err.conflict) editing.reload();
				throw err;
			}
		});
	const labelOf = (value: unknown): string => backend.options.find(option => option.value === value)?.label ?? String(value);
	const picked = backend.options.find(option => option.value === backend.value);
	return (
		<div aria-busy={saving.saving !== null} className="space-y-3 rounded-md border border-border px-4 py-3">
			<div className="flex flex-wrap items-center gap-x-8 gap-y-3">
				<div className="flex items-center gap-2">
					<span id={backendLabel} className="text-sm font-medium">
						Backend
					</span>
					<Select
						value={backend.value}
						disabled={saving.saving !== null || backend.source.layer === "workspace"}
						onValueChange={next => typeof next === "string" && next !== backend.value && save("backend", "memory.backend", backend, next)}
					>
						<SelectTrigger aria-labelledby={backendLabel} aria-describedby={picked?.description ? hintId : undefined} className="w-40">
							<SelectValue>{(shown: unknown) => (saving.saving === "backend" ? "Saving…" : labelOf(shown))}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{backend.options.map(option => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{backend.source.layer === "workspace" && <Lock aria-hidden className="size-3.5 text-muted-foreground" />}
				</div>
				<div className="flex items-center gap-2">
					<span id={autolearnLabel} className="text-sm font-medium">
						{saving.saving === "autolearn" ? "Saving…" : "Auto-learn"}
					</span>
					<ToggleSwitch
						aria-labelledby={autolearnLabel}
						checked={autolearn.enabled.value}
						disabled={saving.saving !== null || autolearn.enabled.source.layer === "workspace"}
						onCheckedChange={checked => save("autolearn", "autolearn.enabled", autolearn.enabled, checked)}
					/>
				</div>
				{configPath && <p className="ml-auto text-xs text-muted-foreground">Saved to {configPath}</p>}
			</div>
			{picked?.description && (
				<p id={hintId} className="text-xs text-muted-foreground">
					{picked.label}: {picked.description}
				</p>
			)}
			<SourceNote setting={backend} format={labelOf} context={context} />
			<p className="text-xs text-muted-foreground">
				Auto-learn: after the agent stops, it is nudged to capture lessons to memory and to create or improve skills of its own. Experimental.
			</p>
			<SourceNote setting={autolearn.enabled} format={onOff} context={context} />
			{autolearn.enabled.value && (
				<div className="space-y-1 border-l border-border pl-3">
					<div className="flex items-center gap-2">
						<span id={continueLabel} className="text-sm">
							{saving.saving === "autoContinue" ? "Saving…" : "Capture on its own at stop"}
						</span>
						<ToggleSwitch
							aria-labelledby={continueLabel}
							checked={autolearn.autoContinue.value}
							disabled={saving.saving !== null || autolearn.autoContinue.source.layer === "workspace"}
							onCheckedChange={checked => save("autoContinue", "autolearn.autoContinue", autolearn.autoContinue, checked)}
						/>
					</div>
					<p className="text-xs text-muted-foreground">On: the agent runs one private capture turn when it stops, which uses extra tokens. Off: only the standing guidance remains.</p>
					<SourceNote setting={autolearn.autoContinue} format={onOff} context={context} />
				</div>
			)}
			{saving.error && <ErrorText>Not saved: {saving.error}</ErrorText>}
		</div>
	);
}

/** The memory block a new session's system prompt gets, folded, with its size in tokens at about four characters each. */
function SessionPreview({ preview }: { preview: OmpMemoryWorkspace["preview"] }) {
	const [open, setOpen] = useState(false);
	if (!preview) return <p className="text-sm text-muted-foreground">A new session here gets no memory in its prompt yet.</p>;
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
			<CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				<ChevronRight aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")} />
				<span className="font-medium">What a new session gets</span>
				<span className="text-xs text-muted-foreground tabular-nums">about {Math.ceil(preview.text.length / 4).toLocaleString()} tokens</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="space-y-2 px-3 pb-3">
				{preview.partial && <p className="text-xs text-muted-foreground">A running session also gets memories recalled for each prompt, which only it can show.</p>}
				<pre className="max-h-[50vh] overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{preview.text}</pre>
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

/** A file backend's files by group, and the one picked, the first by default, viewed and edited in place. */
function MemoryFiles({ files, cwd, context, empty }: { files: OmpMemoryFile[]; cwd: string; context: MemoryContext; empty: string }) {
	const [selected, setSelected] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const open = files.find(file => file.path === selected) ?? files[0];
	if (!open) {
		return (
			<Empty className="border border-dashed border-border">
				<EmptyHeader>
					<EmptyTitle>{empty}</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	}
	const matches = everyWord(query);
	const groups = Map.groupBy(
		files.filter(file => matches(file.name)),
		file => file.group,
	);
	const { memory } = context;
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav aria-label="omp memory files" className="space-y-4">
				{files.length > 8 && <SearchField label="Filter memory files" placeholder="Filter" query={query} onQuery={setQuery} className="min-w-0 flex-1" />}
				{groups.size === 0 && <p className="px-2 text-sm text-muted-foreground">No file matches.</p>}
				{[...groups].map(([group, inGroup]) => (
					<div key={group} className="space-y-1">
						<h4 className="flex items-baseline gap-2 px-2 text-xs font-medium text-muted-foreground">
							{GROUP_LABELS[group]}
							{inGroup.length > 1 && <span className="tabular-nums">{inGroup.length}</span>}
						</h4>
						<ul>
							{inGroup.map(file => (
								<li key={file.path}>
									<Tooltip content={file.pathDisplay}>
										<button type="button" aria-current={file === open ? "true" : undefined} onClick={() => setSelected(file.path)} className={cn(RAIL_BUTTON, file === open && "bg-muted font-medium")}>
											<span className="truncate">{file.name}</span>
										</button>
									</Tooltip>
								</li>
							))}
						</ul>
					</div>
				))}
			</nav>
			<FileView
				key={open.path}
				file={open}
				saver={{ save: edit => putJson<OmpMemory>(ompMemoryUrl("/file", cwd), edit), write: memory.write, reload: memory.reload }}
			/>
		</div>
	);
}

const KIND_LABELS: Record<OmpMemoryEntry["kind"], string> = { working: "Working", episodic: "Episodic", fact: "Fact", remote: "Hindsight" };

/** One entry: its text, which Edit turns into a field that Enter saves and Escape reverts, and the actions omp allows on it. */
function EntryRow({ entry, cwd, context, confirm }: { entry: OmpMemoryEntry; cwd: string; context: MemoryContext; confirm: InlineConfirm }) {
	const [draft, setDraft] = useState<string | null>(null);
	const saving = useSaving();
	const { memory } = context;
	const send = (key: string, edit: OmpMemoryEntryEdit): void =>
		saving.run(key, async () => {
			try {
				await memory.write(() => putJson<OmpMemory>(ompMemoryUrl("/entry", cwd), edit));
				setDraft(null);
			} catch (err) {
				if (err instanceof ApiError && err.conflict) {
					setDraft(null);
					memory.reload();
				}
				throw err;
			}
		});
	const at = entry.at === null ? Number.NaN : Date.parse(entry.at);
	const busy = saving.saving !== null;
	const key = `${entry.bank}:${entry.id}`;
	const save = (): void => {
		if (draft === null || draft.trim() === "" || draft === entry.content) return setDraft(null);
		send("update", { op: "update", bank: entry.bank, id: entry.id, expected: entry.content, content: draft });
	};
	return (
		<li aria-busy={busy} className={cn("flex items-start gap-4 py-2.5 transition-opacity motion-reduce:transition-none", busy && "opacity-60")}>
			<div className="min-w-0 flex-1 space-y-1">
				{draft === null ? (
					<p className="text-sm break-words whitespace-pre-wrap">{entry.content}</p>
				) : (
					<textarea
						aria-label="Memory text"
						autoFocus
						readOnly={busy}
						value={draft}
						rows={Math.min(8, draft.split("\n").length + 1)}
						onChange={event => setDraft(event.target.value)}
						onKeyDown={event => {
							if (event.key === "Escape") {
								event.preventDefault();
								setDraft(null);
							} else if (event.key === "Enter" && !event.shiftKey) {
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
						<Button variant="ghost" size="compact" disabled={busy} onClick={() => setDraft(null)}>
							Cancel
						</Button>
						<Button variant="primary" size="compact" disabled={busy} onClick={save}>
							{saving.saving === "update" ? "Saving…" : "Save"}
						</Button>
					</>
				) : (
					<>
						{entry.ops.includes("update") && (
							<Button variant="ghost" size="compact" disabled={busy} onClick={() => setDraft(entry.content)}>
								Edit
							</Button>
						)}
						{entry.ops.includes("forget") && (
							<Button
								variant="destructive-outline"
								size="compact"
								disabled={busy}
								{...confirm.props(`forget:${key}`, () => send("forget", { op: "forget", bank: entry.bank, id: entry.id, expected: entry.content }))}
							>
								{saving.saving === "forget" ? "Saving…" : confirm.isArmed(`forget:${key}`) ? "Confirm forget?" : "Forget"}
							</Button>
						)}
						{entry.ops.includes("retire") && (
							<Tooltip content="Recall stops using it; the row stays in the store">
								<Button
									variant="destructive-outline"
									size="compact"
									disabled={busy}
									{...confirm.props(`retire:${key}`, () => send("retire", { op: "retire", bank: entry.bank, id: entry.id, expected: entry.content }))}
								>
									{saving.saving === "retire" ? "Saving…" : confirm.isArmed(`retire:${key}`) ? "Confirm retire?" : "Retire"}
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
		return (
			<Empty className="border border-dashed border-border">
				<EmptyHeader>
					<EmptyTitle>{empty}</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	}
	const counts = Map.groupBy(rows.entries, entry => entry.kind);
	const matches = everyWord(query);
	const shown = rows.entries.filter(entry => matches(entry.content));
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<SearchField label="Filter memories" placeholder="Filter" query={query} onQuery={setQuery} className="w-64" />
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

/** What Forget everything removes, `null` when the store has nothing this page can forget at once. */
function clearsOf(store: OmpMemoryStore): string | null {
	switch (store.backend) {
		case "local":
			return "Lessons, the summary, skills, and session summaries for this folder.";
		case "sharpshooter":
			return "The decision files for this folder.";
		case "mnemopi": {
			const own = store.banks.filter(bank => bank !== store.sharedBank);
			if (own.length === 0) return null;
			return `Every memory in ${own.join(", ")}.${store.sharedBank === null ? "" : ` ${store.sharedBank}, shared with other folders, stays.`}`;
		}
		default:
			return null;
	}
}

/** Rebuild summary for Local, and Forget everything for the stores the page can clear, each armed before it runs. */
function StoreActions({ store, cwd, context, confirm }: { store: OmpMemoryStore; cwd: string; context: MemoryContext; confirm: InlineConfirm }) {
	const saving = useSaving();
	const clears = clearsOf(store);
	if (!clears) return null;
	const run = (key: string, part: "/clear" | "/rebuild", body: object): void =>
		saving.run(key, async () => {
			try {
				await context.memory.write(() => putJson<OmpMemory>(ompMemoryUrl(part, cwd), body));
			} catch (err) {
				if (err instanceof ApiError && err.conflict) context.memory.reload();
				throw err;
			}
		});
	const busy = saving.saving !== null;
	return (
		<div className="space-y-2 border-t border-border pt-3">
			<div className="flex flex-wrap items-center justify-end gap-2">
				{store.backend === "local" && (
					<Tooltip content="It runs when the next session here starts">
						<Button variant="secondary" size="compact" disabled={busy} onClick={() => run("rebuild", "/rebuild", {})}>
							{saving.saving === "rebuild" ? "Saving…" : "Rebuild summary"}
						</Button>
					</Tooltip>
				)}
				<Button variant="destructive-outline" size="compact" disabled={busy} {...confirm.props("clear", () => run("clear", "/clear", { backend: store.backend }))}>
					{saving.saving === "clear" ? "Forgetting…" : confirm.isArmed("clear") ? "Confirm forget everything?" : "Forget everything"}
				</Button>
			</div>
			<p className="text-right text-xs text-muted-foreground">{clears}</p>
			{saving.error && <ErrorText>{saving.error}</ErrorText>}
		</div>
	);
}

/** The store of the backend in effect, in its own shape. */
function Store({ store, options, cwd, context }: { store: OmpMemoryStore; options: OmpMemoryBackendOption[]; cwd: string; context: MemoryContext }) {
	const confirm = useInlineConfirm(`omp-memory:${cwd}`);
	let body: ReactNode;
	let meta: ReactNode = null;
	switch (store.backend) {
		case "off":
			return (
				<Empty className="border border-dashed border-border">
					<EmptyHeader>
						<EmptyTitle>omp remembers nothing between sessions here.</EmptyTitle>
						<EmptyDescription>Pick a backend above to start:</EmptyDescription>
					</EmptyHeader>
					<ul className="max-w-lg space-y-1 text-left text-sm text-muted-foreground">
						{options
							.filter(option => option.value !== "off")
							.map(option => (
								<li key={option.value}>
									<span className="font-medium text-foreground">{option.label}</span>
									{option.description && `: ${option.description}`}
								</li>
							))}
					</ul>
				</Empty>
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
	const shared = store.backend === "mnemopi" ? store.sharedBank !== null : store.backend === "hindsight" && store.shared;
	return (
		<Section title="Stored memory" meta={meta}>
			{shared && (
				<p className="text-xs text-warning-foreground">
					{store.backend === "mnemopi"
						? `Every folder reads ${store.sharedBank} too. Editing or forgetting one of its memories changes it everywhere.`
						: "Every folder reads this bank."}
				</p>
			)}
			{body}
			<StoreActions store={store} cwd={cwd} context={context} confirm={confirm} />
		</Section>
	);
}

/**
 * The section, read only while it shows. It reads again whenever the page's settings change, so a save here or in
 * another section shows at once.
 */
export function OmpMemoryTab({
	active,
	editing,
	settingsVersion,
	configFile,
	projectFile,
	onOpenFile,
}: {
	active: boolean;
	editing: Editing;
	/** The page's settings, which this reads again whenever they change. */
	settingsVersion: unknown;
	configFile: OmpFile | undefined;
	projectFile: OmpFile | undefined;
	onOpenFile: (path: string) => void;
}) {
	const { cwd } = editing;
	const memory = useEditableRead<OmpMemory>(active ? ompMemoryUrl("", cwd) : null, settingsVersion);
	const context: MemoryContext = { editing, memory, projectFile, onOpenFile };
	if (memory.data === null) {
		if (memory.error === null) return <p className="text-sm text-muted-foreground">{active ? "Reading omp memory…" : ""}</p>;
		return (
			<div className="space-y-2">
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Cannot read omp memory: {memory.error}
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
	const data = memory.data;
	return (
		<div className="space-y-8">
			<MemoryBar data={data} configPath={configFile?.pathDisplay} context={context} />
			{cwd === null || data.workspace === null ? (
				<p className="text-sm text-muted-foreground">Pick a workspace to see what omp remembers there.</p>
			) : (
				<>
					<div className="space-y-2">
						<SessionPreview preview={data.workspace.preview} />
						<p className="text-xs text-muted-foreground">Running sessions keep what they started with. New sessions see your changes.</p>
					</div>
					<Store store={data.workspace.store} options={data.backend.options} cwd={cwd} context={context} />
				</>
			)}
		</div>
	);
}
