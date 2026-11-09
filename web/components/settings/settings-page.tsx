import { FolderOpen } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared/models";
import type { TrustedProject } from "../../../src/shared/project-trust";
import type { Workspace, WorkspaceList } from "../../../src/shared/workspaces";
import { settingsUrl } from "../../api";
import { useEditableRead } from "../../editable-read";
import { type ReadState, useRead } from "../../reads";
import { ompSettingsFiles } from "../../omp-settings";
import { hashForSettings, SETTINGS_SECTIONS, type SettingsSection } from "../../routing";
import { CommandPicker } from "../command-picker";
import { Header } from "../page-header";
import { AnalyticsTab } from "./analytics-tab";
import { ActivityTab } from "./activity-tab";
import { type Catalog, type Editing, LINK } from "./editor";
import { AgentsTab } from "./agents-tab";
import { DecisionsTab } from "./decisions-tab";
import { Files } from "./files-tab";
import { IntegrationsTab } from "./integrations-tab";
import { McpServersTab } from "./mcp-servers-tab";
import { OmpMemoryTab } from "./omp-memory-tab";
import { OmpSettingsTab } from "./omp-settings-tab";
import { ExtensionsTab } from "./extensions-tab";
import { PreferencesTab } from "./preferences-tab";
import { ProvidersTab } from "./providers-tab";
import { ModelsTab } from "./routing-tab";
import { SourceControlTab } from "./source-control-tab";
import { SyncTab } from "./sync-tab";
import { StorageTab } from "./storage-tab";
import { Workflows } from "./workflows-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { WorktreesTab } from "./worktrees-tab";

const workspaceLabel = (cwd: string, workspaces: Workspace[]): string => workspaces.find((workspace) => workspace.cwd === cwd)?.cwdDisplay ?? cwd;

/** The sidebar's workspace picker again, for the sections it scopes: all workspaces read your user files only. */
function WorkspacePicker({ cwd, workspaces, onPick }: { cwd: string | null; workspaces: Workspace[]; onPick: (cwd: string | null) => void }) {
	const label = cwd === null ? "All workspaces" : workspaceLabel(cwd, workspaces);
	const pick = (next: string | null) => (): void => {
		if (next !== cwd) onPick(next);
	};
	return (
		<CommandPicker
			trigger={<span className="max-w-64 truncate">{label}</span>}
			icon={FolderOpen}
			ariaLabel={`Workspace: ${label}`}
			search={{ label: "Search workspaces" }}
			width="lg"
			list={{
				kind: "ready",
				groups: [
					{ key: "all", items: [{ value: "All workspaces", label: "All workspaces", selected: cwd === null, onSelect: pick(null) }] },
					{
						key: "workspaces",
						heading: "Workspaces",
						items: workspaces.map((workspace) => ({
							value: workspace.cwd,
							label: <span className="truncate">{workspace.cwdDisplay}</span>,
							selected: workspace.cwd === cwd,
							onSelect: pick(workspace.cwd),
						})),
					},
				],
			}}
			empty="No workspace matches."
		/>
	);
}

const PANEL = "space-y-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background";

/** The file Settings › Files shows, which another section can open there. */
interface FileSelection {
	path: string | null;
	open: (path: string) => void;
}

const loadAlert = (error: string): ReactNode => (
	<p role="alert" className="text-sm text-red-600 dark:text-red-400">
		omp cannot load its settings: {error}
	</p>
);

/** Why the omp sections are empty while omp's settings are not read: still reading, or the read failed. */
const readNote = (read: ReadState<OmpSettings>): ReactNode =>
	read.error === null ? (
		<p className="text-sm text-muted-foreground">Reading omp's settings…</p>
	) : (
		<p role="alert" className="text-sm text-red-600 dark:text-red-400">
			Cannot read omp's settings: {read.error}
		</p>
	);

/** The omp sections' content once settings are read, else why they are empty. */
function ompPanels(read: ReadState<OmpSettings>, cwd: string | null, editing: Editing, selection: FileSelection): Record<"models" | "agents" | "omp" | "files" | "workflows", ReactNode> {
	if (read.data === null) {
		const note = readNote(read);
		return { models: note, agents: note, omp: note, files: note, workflows: note };
	}
	const { routing, agentSettings, agents: catalog, files, workflows } = read.data;
	const key = cwd ?? "";
	const filesPanel = <Files key={key} files={files} editing={editing} selected={selection.path} onSelect={selection.open} />;
	const workflowsPanel = <Workflows key={key} workflows={workflows} files={files} editing={editing} />;
	const { configFile, projectFile } = ompSettingsFiles(files);
	const agents = <AgentsTab key={key} catalog={catalog} settings={agentSettings} editing={editing} stale={read.error} configFile={configFile} projectFile={projectFile} onOpenFile={selection.open} />;
	const omp =
		"error" in agentSettings ? (
			<div className="space-y-2">
				{loadAlert(agentSettings.error)}
				{configFile && (
					<p className="text-sm text-muted-foreground">
						<a href={hashForSettings("files")} onClick={() => selection.open(configFile.path)} className={LINK}>
							Fix config.yml in Files
						</a>
					</p>
				)}
			</div>
		) : (
			<OmpSettingsTab
				key={key}
				settings={agentSettings}
				configFile={configFile}
				projectFile={projectFile}
				editing={editing}
				onOpenFile={selection.open}
			/>
		);
	if ("error" in routing) return { models: loadAlert(routing.error), agents, omp, files: filesPanel, workflows: workflowsPanel };
	return {
		models: <ModelsTab routing={routing} configPath={configFile?.pathDisplay} editing={editing} />,
		omp,
		agents,
		files: filesPanel,
		workflows: workflowsPanel,
	};
}

/** One section of the settings: omp's usage, the dashboard's own choices, or omp's routing and files for one workspace or for the user only, each editable in place. */
export function SettingsPage({
	section,
	cwd,
	onPickWorkspace,
	workspaces,
	workspaceList,
	personal,
	trustedProjects,
}: {
	section: SettingsSection;
	/** The sidebar's workspace, `null` for all workspaces, which reads your user files only. */
	cwd: string | null;
	onPickWorkspace: (cwd: string | null) => void;
	workspaces: Workspace[];
	workspaceList: WorkspaceList<Workspace>;
	/** The dashboard's personal directory, for Settings › Workspaces; `null` until the server sends it. */
	personal: Workspace | null;
	/** The projects whose agent code the user trusted, for Settings › Workspaces. */
	trustedProjects: TrustedProject[];
}) {
	const models = useRead<{ models: CatalogModel[] }>("/api/models");
	const catalog = useMemo(
		(): Catalog => ({
			data: models.data && {
				bySelector: new Map(models.data.models.map((model) => [model.selector, model])),
				byProvider: Map.groupBy(models.data.models, (model) => model.provider),
			},
			error: models.error && `Cannot list omp's models: ${models.error}`,
		}),
		[models],
	);
	const settings = useEditableRead<OmpSettings>(settingsUrl("", cwd));
	const editing: Editing = { cwd, catalog, write: settings.write, reload: settings.reload };
	const [openFile, setOpenFile] = useState<string | null>(null);
	// Every section shares one scroller, so a newly opened one would start at the last one's offset.
	const scroller = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		scroller.current?.scrollTo({ top: 0 });
	}, [section]);

	const panels: Record<SettingsSection, ReactNode> = {
		...ompPanels(settings, cwd, editing, { path: openFile, open: setOpenFile }),
		"omp-memory":
			settings.data === null ? (
				readNote(settings)
			) : (
				<OmpMemoryTab key={cwd ?? ""} active={section === "omp-memory"} settings={settings.data} editing={editing} onOpenFile={setOpenFile} />
			),
		analytics: <AnalyticsTab active={section === "analytics"} />,
		activity: <ActivityTab active={section === "activity"} />,
		providers: <ProvidersTab active={section === "providers"} />,
		preferences: <PreferencesTab cwd={cwd} workspace={cwd === null ? null : workspaceLabel(cwd, workspaces)} />,
		integrations: <IntegrationsTab active={section === "integrations"} workspaces={workspaces} />,
		"mcp-servers": <McpServersTab active={section === "mcp-servers"} />,
		"source-control": <SourceControlTab active={section === "source-control"} />,
		workspaces: <WorkspacesTab workspaces={workspaces} list={workspaceList} personalDir={personal} trustedProjects={trustedProjects} />,
		sync: <SyncTab active={section === "sync"} />,
		storage: <StorageTab cwd={cwd} active={section === "storage"} onSaved={settings.reload} />,
		worktrees: <WorktreesTab cwd={cwd} active={section === "worktrees"} />,
		decisions: <DecisionsTab cwd={cwd} active={section === "decisions"} />,
		extensions: <ExtensionsTab cwd={cwd} active={section === "extensions"} onSaved={settings.reload} />,
	};
	// Hidden panels stay mounted so an unsaved draft survives switching sections.
	const body = SETTINGS_SECTIONS.filter(({ value }) => value !== "extensions").map(({ value, label }) => (
		<section key={value} aria-label={label} hidden={section !== value} tabIndex={0} className={PANEL}>
			{panels[value]}
		</section>
	));
	const shown = SETTINGS_SECTIONS.find(({ value }) => value === section)!;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{shown.group === "workspace" ? (
				<Header title={shown.label} meta={cwd === null ? shown.meta.none : shown.meta.workspace}>
					<WorkspacePicker cwd={cwd} workspaces={workspaces} onPick={onPickWorkspace} />
				</Header>
			) : (
				<Header title={shown.label} />
			)}
			{/* Relative, so an absolute child such as a table's `sr-only` caption stays in this scroll and never makes the document scroll. */}
			<div ref={scroller} hidden={section === "extensions"} className="relative min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
			</div>
			<section aria-label="Extensions" hidden={section !== "extensions"} className="min-h-0 flex-1">
				{panels.extensions}
			</section>
		</div>
	);
}
