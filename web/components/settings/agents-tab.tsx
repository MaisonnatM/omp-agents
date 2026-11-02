/** Settings › Agents compares omp's discovered definitions and edits user defaults for later spawns. */
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AgentSettingEdit, AgentSettingRow } from "../../../src/shared/agent-settings";
import type { AgentCatalog, AgentDefinitionPreview, AgentModelOverride } from "../../../src/shared/agents";
import { everyWord } from "../../../src/shared/every-word";
import type { OmpSettings } from "../../../src/shared/models";
import { putJson, settingsUrl } from "../../api";
import { formatValue, valueOf } from "../../omp-settings";
import { hashForSettings } from "../../routing";
import { useInlineConfirm } from "../../use-inline-confirm";
import { Model } from "../model-picker";
import { EditBar, type Editing, ErrorText, FIELD, LINK, OrderedList, RAIL_BUTTON, SaveError, Section, useEditor } from "./editor";
import { SelectorPicker } from "./selector-picker";

const selectors = (value: AgentModelOverride | undefined): string => value === undefined ? "Use agent definition" : Array.isArray(value) ? value.join(", ") : value;
const scopeName = { user: "User", project: "Project", bundled: "Bundled" };

function Fold({ title, children, initial = false }: { title: string; children: ReactNode; initial?: boolean }) {
	const [open, setOpen] = useState(initial);
	const id = useId();
	return <div className="space-y-3"><button type="button" className={RAIL_BUTTON} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}<span className="font-medium">{title}</span></button><div id={id} hidden={!open} className="pl-6">{children}</div></div>;
}

function FileLink({ path, onOpenFile, children }: { path: string | undefined; onOpenFile: (path: string) => void; children: string }) {
	return path ? <a className={LINK} href={hashForSettings("files")} onClick={() => onOpenFile(path)}>{children}</a> : null;
}

function EffectiveModel({ agent, compact = false }: { agent: AgentDefinitionPreview; compact?: boolean }) {
	switch (agent.model.kind) {
		case "source-session": return <>Model chosen from source session or invocation</>;
		case "inherited": return <>Inherits the session model</>;
		case "resolved": return <><Model selector={agent.model.selector} />{agent.model.thinking && <span className="text-muted-foreground"> · {agent.model.thinking}</span>}</>;
		case "unresolved": return <span>{(compact ? agent.effective[0] : agent.effective.join(", ")) || "No model resolved"}{compact && agent.effective.length > 1 && <span className="tabular-nums"> +{agent.effective.length - 1} choices</span>}<span className="text-muted-foreground"> · No matching model available</span></span>;
	}
}

function OverrideEditor({ name, value, workspace, sourceSession = false, clearOnly = false, roles, editing, projectPath, onOpenFile }: { name: string; value: AgentModelOverride | undefined; workspace?: AgentModelOverride; sourceSession?: boolean; clearOnly?: boolean; roles: string[]; editing: Editing; projectPath?: string; onOpenFile: (path: string) => void }) {
	const [status, setStatus] = useState("");
	const editor = useEditor<{ value: AgentModelOverride | null; expected: AgentModelOverride | null }>(
		{ value: value ?? null, expected: value ?? null },
		async draft => {
			const result = await putJson<OmpSettings>(settingsUrl("/agent", editing.cwd), { id: "task.agentModelOverrides", entry: name, expected: draft.expected, ...(draft.value === null ? { reset: true } : { value: draft.value }) } satisfies AgentSettingEdit);
			setStatus(`Saved model override for ${name}.`);
			return result;
		}, editing,
	);
	const label = useId();
	const confirm = useInlineConfirm(name);
	const viewing = editor.state.phase === "viewing";
	const draft = editor.draft.value;
	const pick = (value: AgentModelOverride | null): void => editor.change({ ...editor.draft, value });
	return <div className="space-y-3">
		<div className="flex flex-wrap items-center justify-between gap-3"><span id={label} className="text-sm font-medium">User model override</span>{(!sourceSession || value !== undefined) && <EditBar editor={editor} label={`${name} model override`} />}</div>
		{viewing ? <p className="break-words text-sm">{selectors(value)}</p> : <fieldset disabled={editor.state.phase === "saving"} className="min-w-0 space-y-3">
			{!sourceSession && !clearOnly && <>
				{Array.isArray(draft) ? <OrderedList items={draft} label={entry => entry} onChange={next => pick(next.length ? next : null)} render={(entry, index) => <SelectorPicker value={entry} label={`${name} model ${index + 1}`} labelId={label} catalog={editing.catalog} roles={roles} onPick={next => pick(draft.map((value, other) => other === index ? next : value))} />} add={<SelectorPicker value={null} label={`Add model for ${name}`} catalog={editing.catalog} roles={roles} onPick={next => pick([...draft, next])} />} /> : <SelectorPicker value={draft} label={`${name} user model override`} labelId={label} catalog={editing.catalog} roles={roles} onPick={pick} />}
				{draft !== null && !Array.isArray(draft) && <Button variant="ghost" size="compact" onClick={() => pick([draft])}>Use ordered model choices</Button>}
			</>}
			{draft === null ? <p className="text-xs text-muted-foreground">Use agent definition. Save to remove your override.</p> : <Button variant="destructive-outline" size="compact" {...confirm.props("clear", () => pick(null))}>{confirm.isArmed("clear") ? "Confirm clear user override" : "Clear user override"}</Button>}
		</fieldset>}
		{sourceSession && <p className="text-xs text-muted-foreground">Not used by bundled seance. You can clear a saved override, but its model comes from the source session or invocation.</p>}
		{workspace !== undefined && !sourceSession && <p className="text-xs text-muted-foreground">Saved for other workspaces. This workspace still uses {selectors(workspace)}. <FileLink path={projectPath} onOpenFile={onOpenFile}>Open workspace config in Files</FileLink></p>}
		<SaveError editor={editor} /><p role="status" className="text-xs text-muted-foreground">{status}</p>
		{editor.state.phase === "editing" && editor.state.conflict && <p className="text-xs text-muted-foreground">Refresh, then cancel and edit again to use the latest saved value. Your draft is kept until you cancel.</p>}
	</div>;
}

function AgentRow({ agent, catalog, editing, projectPath, onOpenFile, isolation }: { agent: AgentDefinitionPreview; catalog: AgentCatalog; editing: Editing; projectPath?: string; onOpenFile: (path: string) => void; isolation: boolean }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	return <article className="border-b border-border py-3 last:border-b-0">
		<button type="button" aria-expanded={open} aria-controls={id} className={`${RAIL_BUTTON} flex-wrap items-start gap-y-1`} onClick={() => setOpen(!open)}>
			{open ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
			<span className="min-w-0 flex-1 space-y-1"><span className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="font-medium">{agent.name}</span><span className="text-xs text-muted-foreground">{agent.origin === "plugin" ? "Plugin · " : ""}{scopeName[agent.scope]}</span><span className="text-xs text-muted-foreground">{agent.readOnly ? "Read-only" : "Not classified read-only"}</span>{agent.disabled && <span className="text-xs text-muted-foreground">Disabled in settings</span>}</span><span className="block text-xs text-muted-foreground">{agent.description}</span></span>
			<span className="min-w-0 break-words text-xs sm:max-w-80"><EffectiveModel agent={agent} compact /></span>
		</button>
		<div id={id} hidden={!open} className="space-y-5 px-2 pt-5 pl-8">
			<dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-xs">
				<dt className="text-muted-foreground">Source</dt><dd className="break-words">{agent.package && <span>{agent.package} · </span>}{agent.path ?? "Bundled with omp"}</dd>
				<dt className="text-muted-foreground">Tools</dt><dd className="break-words">{agent.tools === null ? "Full capabilities; runtime availability varies" : agent.tools.length ? agent.tools.join(", ") : "No tools declared"}</dd>
				<dt className="text-muted-foreground">Isolation</dt><dd>{agent.model.kind === "source-session" ? "Unsupported for bundled seance" : `Chosen per task, ${isolation ? "allowed here" : "not allowed here"}`}</dd>
				<dt className="text-muted-foreground">Definition</dt><dd className="break-words">{agent.definition.join(", ") || "Inherit session model"}</dd>
				<dt className="text-muted-foreground">Effective</dt><dd className="break-words"><EffectiveModel agent={agent} />{agent.workspace !== undefined ? " · Workspace override" : agent.user !== undefined && agent.model.kind !== "source-session" ? " · User override" : ""}</dd>
				{agent.effective.length > 0 && <><dt className="text-muted-foreground">Model choices</dt><dd className="break-words">{agent.effective.join(", ")}</dd></>}
			</dl>
			{agent.model.kind === "unresolved" && agent.model.warning && <p className="text-xs text-muted-foreground">{agent.model.warning}</p>}
			<OverrideEditor name={agent.name} value={agent.user} workspace={agent.workspace} sourceSession={agent.model.kind === "source-session"} roles={catalog.roles} editing={editing} projectPath={projectPath} onOpenFile={onOpenFile} />
		</div>
	</article>;
}

const EXECUTION_LABELS: Record<string, string> = { "task.maxConcurrency": "Max concurrent subagents", "task.isolation.enabled": "Allow isolated tasks", "task.isolation.apply": "Apply successful changes", "task.isolation.merge": "Apply method" };
function ExecutionRow({ row, editing, projectPath, onOpenFile }: { row: AgentSettingRow; editing: Editing; projectPath?: string; onOpenFile: (path: string) => void }) {
	const id = useId();
	const [status, setStatus] = useState("");
	const editor = useEditor({ value: row.user ?? null, expected: row.user ?? null }, async draft => {
		const result = await putJson<OmpSettings>(settingsUrl("/agent", editing.cwd), { id: row.id, expected: draft.expected, ...(draft.value === null ? { reset: true } : { value: draft.value }) } satisfies AgentSettingEdit);
		setStatus(`Saved ${EXECUTION_LABELS[row.id]!.toLowerCase()}.`);
		return result;
	}, editing);
	const options = row.control.kind === "select" ? row.control.options : [{ value: "true", label: "On" }, { value: "false", label: "Off" }];
	const current = editor.draft.value;
	const listed = options.some(option => String(option.value) === String(current));
	const viewing = editor.state.phase === "viewing";
	return <div className="space-y-2 py-3">
		<div className="flex flex-wrap items-center justify-between gap-3"><span id={id} className="text-sm font-medium">{EXECUTION_LABELS[row.id]}</span><EditBar editor={editor} label={EXECUTION_LABELS[row.id]!} /></div>
		{viewing ? <p className="text-sm tabular-nums">{formatValue(row, valueOf(row))}</p> : <Select disabled={editor.state.phase === "saving"} value={current === null ? "inherit" : String(current)} onValueChange={value => editor.change({ ...editor.draft, value: value === "inherit" ? null : row.control.kind === "toggle" ? value === "true" : typeof row.default === "number" ? Number(value) : value })}><SelectTrigger aria-labelledby={id} className="tabular-nums"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Use omp default ({formatValue(row, row.default)})</SelectItem>{current !== null && !listed && <SelectItem value={String(current)}>{String(current)}</SelectItem>}{options.map(option => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent></Select>}
		{row.id === "task.maxConcurrency" && <p className="text-xs text-muted-foreground">Zero means unlimited.</p>}
		{row.id === "task.isolation.enabled" && <p className="text-xs text-muted-foreground">Allows individual tasks to request a separate checkout. Other tasks still share the parent checkout.</p>}
		{row.id === "task.isolation.apply" && <p className="text-xs text-muted-foreground">Applies successful changes to the parent checkout, subject to its worktree guard.</p>}
		{row.workspace !== undefined && <p className="text-xs text-muted-foreground">Your default is {formatValue(row, row.user ?? row.default)}. This workspace still uses {formatValue(row, row.workspace)}. <FileLink path={projectPath} onOpenFile={onOpenFile}>Open workspace config in Files</FileLink></p>}
		{row.env && <p className="text-xs text-muted-foreground">An environment variable overrides this setting.</p>}
		<SaveError editor={editor} /><p role="status" className="text-xs text-muted-foreground">{status}</p>
	</div>;
}

export function AgentsTab({ catalog, editing, stale, configPath, projectPath, onOpenFile }: { catalog: AgentCatalog | { error: string }; editing: Editing; stale: string | null; configPath?: string; projectPath?: string; onOpenFile: (path: string) => void }) {
	const previous = useRef<AgentCatalog | null>(null);
	if (!("error" in catalog)) previous.current = catalog;
	const data = "error" in catalog ? previous.current : catalog;
	const error = "error" in catalog ? catalog.error : stale;
	const [query, setQuery] = useState("");
	const search = useId();
	const isolation = data?.execution.find(row => row.id === "task.isolation.enabled");
	const allowIsolation = isolation ? Boolean(valueOf(isolation)) : false;
	const matchText = everyWord(query);
	const matches = (agent: AgentDefinitionPreview): boolean => matchText([agent.name, agent.description, scopeName[agent.scope], agent.origin, agent.package ?? "", agent.path ?? "", ...(agent.tools ?? []), ...agent.definition, ...agent.effective, selectors(agent.user), selectors(agent.workspace), agent.model.kind === "resolved" ? agent.model.selector : ""].join(" "));
	const missing = data && Object.keys(data.userOverrides).filter(name => !data.agents.some(agent => agent.name === name)).sort();
	return <Section title="Agent definitions and model overrides" meta={data?.context === "user-preview" ? "Preview of a new session with user defaults only. Project and session-local agents are excluded." : "Preview of a new session in this workspace. Running sessions can have different agents and model choices."} actions={<Button variant="ghost" size="compact" leadingIcon={RefreshCw} onClick={editing.reload}>Refresh</Button>}>
		<p className="text-xs text-muted-foreground">User defaults affect later spawns, not already running subagents. Invocation choices, sign-in fallback, and hooks can still change the model.</p>
		{error && <div className="space-y-2"><ErrorText>Cannot refresh agents. {error}{data && " The previous preview is stale. Refresh before saving."}</ErrorText><FileLink path={configPath} onOpenFile={onOpenFile}>Open config file in Files</FileLink></div>}
		{data?.modelError && <ErrorText>Cannot preview matching models. {data.modelError} Saved model choices are still shown.</ErrorText>}
		<div className="space-y-1"><label htmlFor={search} className="text-xs font-medium">Search agents</label><input id={search} type="search" value={query} onChange={event => setQuery(event.target.value)} className={`${FIELD} w-full`} placeholder="Name, description, tools, or model" /></div>
		{data && <fieldset disabled={Boolean(error)} className="min-w-0 space-y-6">
			<div>{data.agents.map(agent => <div key={agent.name} hidden={!matches(agent)}><AgentRow agent={agent} catalog={data} editing={editing} projectPath={projectPath} onOpenFile={onOpenFile} isolation={allowIsolation} /></div>)}</div>
			{!data.agents.some(matches) && <div className="space-y-2"><p className="text-sm">{query ? "No agents match your search." : "No agents available in this context."}</p>{query && <Button variant="ghost" size="compact" onClick={() => setQuery("")}>Clear search</Button>}</div>}
			{data.agents.length > 0 && data.agents.every(agent => agent.disabled) && <p className="text-sm text-muted-foreground">No agents available in this context. Every discovered agent is disabled.</p>}
			{missing && missing.length > 0 && <Fold title="Overrides for missing agents"><div className="space-y-6">{missing.map(name => <div key={name} className="space-y-2"><h4 className="text-sm font-medium">{name}</h4><p className="text-xs text-muted-foreground">No definition was discovered in this preview.</p><OverrideEditor name={name} value={data.userOverrides[name]} clearOnly roles={data.roles} editing={editing} onOpenFile={onOpenFile} /></div>)}</div></Fold>}
			<Fold title="Execution settings"><div className="divide-y divide-border">{data.execution.map(row => <div key={row.id} hidden={!allowIsolation && (row.id === "task.isolation.apply" || row.id === "task.isolation.merge")}><ExecutionRow row={row} editing={editing} projectPath={projectPath} onOpenFile={onOpenFile} /></div>)}</div></Fold>
		</fieldset>}
	</Section>;
}
