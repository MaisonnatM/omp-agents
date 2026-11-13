/** Settings › Agents compares omp's discovered definitions and edits user defaults for later spawns. */
import { IconArrowRotateClockwise, IconChevronRight } from "central-icons";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentSettings } from "../../../src/shared/agent-settings";
import { AGENT_SETTINGS, type AgentCatalog, type AgentDefinitionPreview, type AgentModelOverride } from "../../../src/shared/agents";
import { everyWord } from "../../../src/shared/every-word";
import type { OmpFile } from "../../../src/shared/models";
import { valueOf } from "../../omp-settings";
import { useInlineConfirm } from "../../use-inline-confirm";
import { FoldButton, useFolds } from "../fold";
import { Model } from "../model-picker";
import { SearchField } from "../search-field";
import { EditBar, type Editing, ErrorText, FileLink, OrderedList, RAIL_BUTTON, saveAgentSetting, SaveError, Section, SettingRow, useEditor } from "./editor";
import { SelectorPicker } from "./selector-picker";

const EXECUTION_SETTINGS: ReadonlySet<string> = new Set(Object.values(AGENT_SETTINGS).filter((id) => id !== AGENT_SETTINGS.overrides));
const FOLDED_BY_DEFAULT = (): boolean => true;

const selectors = (value: AgentModelOverride | undefined): string =>
	value === undefined ? "Use agent definition" : Array.isArray(value) ? value.join(", ") : value;

function EffectiveModel({ agent, compact = false }: { agent: AgentDefinitionPreview; compact?: boolean }) {
	switch (agent.model.kind) {
		case "source-session":
			return <>Model chosen from source session or invocation</>;
		case "inherited":
			return <>Inherits the session model</>;
		case "resolved":
			return (
				<>
					<Model selector={agent.model.selector} />
					{agent.model.thinking && <span className="text-muted-foreground"> · {agent.model.thinking}</span>}
				</>
			);
		case "unresolved":
			return (
				<span>
					{(compact ? agent.effective[0] : agent.effective.join(", ")) || "No model resolved"}
					{compact && agent.effective.length > 1 && <span className="tabular-nums"> +{agent.effective.length - 1} choices</span>}
					<span className="text-muted-foreground"> · No matching model available</span>
				</span>
			);
	}
}

function OverrideEditor({
	name,
	value,
	workspace,
	mode,
	roles,
	editing,
	projectFile,
	onOpenFile,
}: {
	name: string;
	value: AgentModelOverride | undefined;
	workspace?: AgentModelOverride;
	mode: "editable" | "missing" | "seance";
	roles: string[];
	editing: Editing;
	projectFile?: OmpFile;
	onOpenFile: (path: string) => void;
}) {
	const [status, setStatus] = useState("");
	const editor = useEditor<{ value: AgentModelOverride | null; expected: AgentModelOverride | null }>(
		{ value: value ?? null, expected: value ?? null },
		async (draft) => {
			const result = await saveAgentSetting(editing, {
				id: AGENT_SETTINGS.overrides,
				entry: name,
				expected: draft.expected,
				...(draft.value === null ? { reset: true } : { value: draft.value }),
			});
			setStatus(`Saved model override for ${name}.`);
			return result;
		},
	);
	const label = useId();
	const confirm = useInlineConfirm(name);
	const viewing = editor.state.phase === "viewing";
	const draft = editor.draft.value;
	const pick = (value: AgentModelOverride | null): void => editor.change({ ...editor.draft, value });
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span id={label} className="text-sm font-medium">
					User model override
				</span>
				{(mode !== "seance" || value !== undefined) && <EditBar editor={editor} label={`${name} model override`} />}
			</div>
			{viewing ? (
				<p className="break-words text-sm">{selectors(value)}</p>
			) : (
				<fieldset disabled={editor.state.phase === "saving"} className="min-w-0 space-y-3">
					{mode === "editable" && (
						<>
							{Array.isArray(draft) ? (
								<OrderedList
									items={draft}
									label={(entry) => entry}
									onChange={(next) => pick(next.length ? next : null)}
									render={(entry, index) => (
										<SelectorPicker
											value={entry}
											label={`${name} model ${index + 1}`}
											labelId={label}
											catalog={editing.catalog}
											roles={roles}
											onPick={(next) => pick(draft.map((value, other) => (other === index ? next : value)))}
										/>
									)}
									add={
										<SelectorPicker
											value={null}
											label={`Add model for ${name}`}
											catalog={editing.catalog}
											roles={roles}
											onPick={(next) => pick([...draft, next])}
										/>
									}
								/>
							) : (
								<SelectorPicker value={draft} label={`${name} user model override`} labelId={label} catalog={editing.catalog} roles={roles} onPick={pick} />
							)}
							{draft !== null && !Array.isArray(draft) && (
								<Button variant="ghost" size="compact" onClick={() => pick([draft])}>
									Use ordered model choices
								</Button>
							)}
						</>
					)}
					{draft === null ? (
						<p className="text-xs text-muted-foreground">Use agent definition. Save to remove your override.</p>
					) : (
						<Button variant="destructive-outline" size="compact" {...confirm.props("clear", () => pick(null))}>
							{confirm.isArmed("clear") ? "Confirm clear user override" : "Clear user override"}
						</Button>
					)}
				</fieldset>
			)}
			{mode === "seance" && (
				<p className="text-xs text-muted-foreground">
					Not used by bundled seance. You can clear a saved override, but its model comes from the source session or invocation.
				</p>
			)}
			{workspace !== undefined && mode !== "seance" && (
				<p className="text-xs text-muted-foreground">
					Saved for other workspaces. This workspace still uses {selectors(workspace)}.{" "}
					{projectFile && (
						<FileLink file={projectFile} onOpenFile={onOpenFile}>
							Open workspace config in Files
						</FileLink>
					)}
				</p>
			)}
			<SaveError editor={editor} />
			<p role="status" className="text-xs text-muted-foreground">
				{status}
			</p>
			{editor.state.phase === "editing" && editor.state.conflict && (
				<p className="text-xs text-muted-foreground">Refresh, then cancel and edit again to use the latest saved value. Your draft is kept until you cancel.</p>
			)}
		</div>
	);
}

function AgentRow({
	agent,
	catalog,
	editing,
	projectFile,
	onOpenFile,
	isolation,
}: {
	agent: AgentDefinitionPreview;
	catalog: AgentCatalog;
	editing: Editing;
	projectFile?: OmpFile;
	onOpenFile: (path: string) => void;
	isolation: boolean;
}) {
	const [open, setOpen] = useState(false);
	const id = useId();
	return (
		<article className="border-b border-border py-3 last:border-b-0">
			<button type="button" aria-expanded={open} aria-controls={id} className={cn(RAIL_BUTTON, "items-start")} onClick={() => setOpen(!open)}>
				<IconChevronRight className={cn("mt-0.5 size-4 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="grid min-w-0 flex-1 gap-x-5 gap-y-1 sm:grid-cols-3">
					<span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:col-span-2">
						<span className="font-medium">{agent.name}</span>
						<span className="text-xs text-muted-foreground">
							{agent.origin === "plugin" ? "plugin · " : ""}
							{agent.scope}
						</span>
						<span className="text-xs text-muted-foreground">{agent.readOnly ? "Read-only" : "Not classified read-only"}</span>
						{agent.disabled && (
							<Badge variant="dot" size="compact" color="gray">
								Disabled
							</Badge>
						)}
					</span>
					<span className="text-xs text-muted-foreground sm:col-span-2 sm:col-start-1 sm:row-start-2">{agent.description}</span>
					<span className="min-w-0 break-words text-xs sm:col-start-3 sm:row-span-2 sm:row-start-1">
						<EffectiveModel agent={agent} compact />
					</span>
				</span>
			</button>
			<div id={id} hidden={!open} className="space-y-5 px-2 pt-5 pl-8">
				<dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-xs">
					<dt className="text-muted-foreground">Source</dt>
					<dd className="break-words">
						{agent.package && <span>{agent.package} · </span>}
						{agent.path ?? "Bundled with omp"}
					</dd>
					<dt className="text-muted-foreground">Tools</dt>
					<dd className="break-words">
						{agent.tools === null ? "Full capabilities; runtime availability varies" : agent.tools.length ? agent.tools.join(", ") : "No tools declared"}
					</dd>
					<dt className="text-muted-foreground">Isolation</dt>
					<dd>{agent.seance ? "Unsupported for bundled seance" : `Chosen per task, ${isolation ? "allowed here" : "not allowed here"}`}</dd>
					<dt className="text-muted-foreground">Definition</dt>
					<dd className="break-words">{agent.definition.join(", ") || "Inherit session model"}</dd>
					<dt className="text-muted-foreground">Effective</dt>
					<dd className="break-words">
						<EffectiveModel agent={agent} />
						{agent.workspace !== undefined ? " · Workspace override" : agent.user !== undefined && !agent.seance ? " · User override" : ""}
					</dd>
					{agent.effective.length > 0 && (
						<>
							<dt className="text-muted-foreground">Model choices</dt>
							<dd className="break-words">{agent.effective.join(", ")}</dd>
						</>
					)}
				</dl>
				{agent.model.kind === "unresolved" && agent.model.warning && <p className="text-xs text-muted-foreground">{agent.model.warning}</p>}
				<OverrideEditor
					name={agent.name}
					value={agent.user}
					workspace={agent.workspace}
					mode={agent.seance ? "seance" : "editable"}
					roles={catalog.roles}
					editing={editing}
					projectFile={projectFile}
					onOpenFile={onOpenFile}
				/>
			</div>
		</article>
	);
}

interface Preview {
	catalog: AgentCatalog;
	settings: AgentSettings;
}

export function AgentsTab({
	catalog,
	settings,
	editing,
	stale,
	configFile,
	projectFile,
	onOpenFile,
}: {
	catalog: AgentCatalog | { error: string };
	settings: AgentSettings | { error: string };
	editing: Editing;
	stale: string | null;
	configFile?: OmpFile;
	projectFile?: OmpFile;
	onOpenFile: (path: string) => void;
}) {
	const [previous, setPrevious] = useState<Preview | null>(() => ("error" in catalog || "error" in settings ? null : { catalog, settings }));
	useEffect(() => {
		if (!("error" in catalog) && !("error" in settings)) setPrevious({ catalog, settings });
	}, [catalog, settings]);
	const preview = "error" in catalog || "error" in settings ? previous : { catalog, settings };
	const data = preview?.catalog;
	const error = "error" in catalog ? catalog.error : "error" in settings ? settings.error : stale;
	const [query, setQuery] = useState("");
	const folds = useFolds(`omp-agents.settings.agents.${editing.cwd ?? "user"}`, FOLDED_BY_DEFAULT);
	const missingId = useId();
	const executionId = useId();
	const execution = preview?.settings.tabs.flatMap((tab) => tab.groups.flatMap((group) => group.rows)).filter((row) => EXECUTION_SETTINGS.has(row.id)) ?? [];
	const isolation = execution.find((row) => row.id === AGENT_SETTINGS.isolationEnabled);
	const allowIsolation = isolation ? Boolean(valueOf(isolation)) : false;
	const matchText = everyWord(query);
	const matches = (agent: AgentDefinitionPreview): boolean =>
		matchText(
			[
				agent.name,
				agent.description,
				agent.scope,
				agent.origin,
				agent.package ?? "",
				agent.path ?? "",
				...(agent.tools ?? []),
				...agent.definition,
				...agent.effective,
				selectors(agent.user),
				selectors(agent.workspace),
				agent.model.kind === "resolved" ? agent.model.selector : "",
			].join(" "),
		);
	const missing =
		data &&
		Object.keys(data.userOverrides)
			.filter((name) => !data.agents.some((agent) => agent.name === name))
			.sort();
	return (
		<Section
			meta={
				data?.context === "user-preview" ? "Project and session-local agents are excluded." : "Running sessions can have different agents and model choices."
			}
			actions={
				<Button variant="ghost" size="compact" leadingIcon={IconArrowRotateClockwise} onClick={editing.reload}>
					Refresh
				</Button>
			}
		>
			<p className="text-xs text-muted-foreground">
				User defaults affect later spawns, not already running subagents. Invocation choices, sign-in fallback, and hooks can still change the model.
			</p>
			{error && (
				<div className="space-y-2">
					<ErrorText>
						Cannot refresh agents.{data && " The previous preview is stale; refresh before saving."} {error}
					</ErrorText>
					{configFile && (
						<p className="text-xs text-muted-foreground">
							<FileLink file={configFile} onOpenFile={onOpenFile}>
								Open config file in Files
							</FileLink>
						</p>
					)}
				</div>
			)}
			{data?.modelError && <ErrorText>Cannot preview matching models. Saved model choices are still shown. {data.modelError}</ErrorText>}
			<SearchField label="Search agents" placeholder="Search" query={query} onQuery={setQuery} className="min-w-0 w-full" />
			{data && (
				<fieldset disabled={Boolean(error)} className="min-w-0 space-y-6">
					<div>
						{data.agents.map((agent) => (
							<div key={agent.name} hidden={!matches(agent)}>
								<AgentRow agent={agent} catalog={data} editing={editing} projectFile={projectFile} onOpenFile={onOpenFile} isolation={allowIsolation} />
							</div>
						))}
					</div>
					{!data.agents.some(matches) && (
						<div className="space-y-2">
							<p className="text-sm text-muted-foreground">{query ? "No agent matches." : "No agents available in this context."}</p>
							{query && (
								<Button variant="ghost" size="compact" onClick={() => setQuery("")}>
									Clear search
								</Button>
							)}
						</div>
					)}
					{data.agents.length > 0 && data.agents.every((agent) => agent.disabled) && (
						<p className="text-sm text-muted-foreground">No agents available in this context. Every discovered agent is disabled.</p>
					)}
					{missing && missing.length > 0 && (
						<div className="space-y-3">
							<FoldButton
								open={!folds.isFolded("missing")}
								controls={missingId}
								onToggle={() => folds.toggle("missing")}
								className="ml-0 min-h-7 px-2 text-sm [&>svg]:size-4"
							>
								<span className="font-medium">Overrides for missing agents</span>
							</FoldButton>
							<div id={missingId} hidden={folds.isFolded("missing")} className="space-y-6 pl-8">
								{missing.map((name) => (
									<div key={name} className="space-y-2">
										<h4 className="text-sm font-medium">{name}</h4>
										<p className="text-xs text-muted-foreground">No definition was discovered in this preview.</p>
										<OverrideEditor name={name} value={data.userOverrides[name]} mode="missing" roles={data.roles} editing={editing} onOpenFile={onOpenFile} />
									</div>
								))}
							</div>
						</div>
					)}
					<div className="space-y-3">
						<FoldButton
							open={!folds.isFolded("execution")}
							controls={executionId}
							onToggle={() => folds.toggle("execution")}
							className="ml-0 min-h-7 px-2 text-sm [&>svg]:size-4"
						>
							<span className="font-medium">Execution settings</span>
						</FoldButton>
						<ul id={executionId} hidden={folds.isFolded("execution")} className="divide-y divide-border pl-8">
							{execution.map((row) => (
								<SettingRow
									key={row.id}
									row={row}
									mode="explicit"
									hidden={!allowIsolation && (row.id === AGENT_SETTINGS.isolationApply || row.id === AGENT_SETTINGS.isolationMerge)}
									context={{ editing, projectFile, onOpenFile }}
								/>
							))}
						</ul>
					</div>
				</fieldset>
			)}
		</Section>
	);
}
