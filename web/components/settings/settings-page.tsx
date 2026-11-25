import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { OmpSettings } from "../../../src/shared/models";
import type { TrustedProject } from "../../../src/shared/project-trust";
import type { Workspace, WorkspaceList } from "../../../src/shared/workspaces";
import { isPhonePage } from "../../api";
import type { ReadState } from "../../reads";
import { ompSettingsFiles } from "../../omp-settings";
import { hashForSettings, SETTINGS_SECTIONS, type SettingsSection } from "../../routing";
import { Header } from "../page-header";
import { AnalyticsTab } from "./analytics-tab";
import { ActivityTab } from "./activity-tab";
import { type Editing, LINK, settingsReadNote, useSettingsEditing } from "./editor";
import { AgentsTab } from "./agents-tab";
import { DecisionsTab } from "./decisions-tab";
import { Files } from "./files-tab";
import { IntegrationsTab } from "./integrations-tab";
import { KeyboardTab } from "./keyboard-tab";
import { McpServersTab } from "./mcp-servers-tab";
import { ModulesTab } from "./modules-tab";
import { OmpMemoryTab } from "./omp-memory-tab";
import { OmpSettingsTab } from "./omp-settings-tab";
import { ExtensionsTab } from "./extensions-tab";
import { PhoneAccessTab } from "./phone-access-tab";
import { PreferencesTab } from "./preferences-tab";
import { ProvidersTab } from "./providers-tab";
import { ModelsTab } from "./routing-tab";
import { SourceControlTab } from "./source-control-tab";
import { SyncTab } from "./sync-tab";
import { StorageTab } from "./storage-tab";
import { Workflows } from "./workflows-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { WorktreesTab } from "./worktrees-tab";
import { WhatsNewTab } from "../whats-new";
import { WorkspacePicker, workspaceLabel } from "../workspace-picker";

const PANEL = "space-y-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background";

/** The file Settings › Files shows, which another section can open there. */
interface FileSelection {
	path: string | null;
	open: (path: string) => void;
	/** The address of a section on the same page: global Settings', or a Board's Settings tab's. */
	sectionHash: (section: SettingsSection) => string;
}

const loadAlert = (error: string): ReactNode => (
	<p role="alert" className="text-sm text-red-600 dark:text-red-400">
		omp cannot load its settings: {error}
	</p>
);

/** The omp sections' content once settings are read, else why they are empty. */
function ompPanels(read: ReadState<OmpSettings>, cwd: string | null, editing: Editing, selection: FileSelection): Record<"models" | "agents" | "omp" | "files" | "workflows", ReactNode> {
	if (read.data === null) {
		const note = settingsReadNote(read);
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
						<a href={selection.sectionHash("files")} onClick={() => selection.open(configFile.path)} className={LINK}>
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

/** Which settings a page holds: all of them, with a header picker for the workspace, or one workspace's sections, as on a Board's Settings tab, whose section links stay on that tab. */
export type SettingsScope =
	| { kind: "all"; onPickWorkspace: (cwd: string | null) => void; workspaceList: WorkspaceList<Workspace>; trustedProjects: TrustedProject[] }
	| { kind: "workspace"; sectionHash: (section: SettingsSection) => string };

/** One section of the settings: omp's usage, the dashboard's own choices, or omp's routing and files for one workspace or for the user only, each editable in place. */
export function SettingsPage({
	section,
	cwd,
	workspaces,
	scope,
}: {
	section: SettingsSection;
	/** The sidebar's workspace, `null` for all workspaces, which reads your user files only. */
	cwd: string | null;
	/** The workspaces the header's picker offers and Settings › Workspaces lists. */
	workspaces: Workspace[];
	scope: SettingsScope;
}) {
	const { settings, editing } = useSettingsEditing(cwd);
	const [openFile, setOpenFile] = useState<string | null>(null);
	// Every section shares one scroller, so a newly opened one would start at the last one's offset.
	const scroller = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		scroller.current?.scrollTo({ top: 0 });
	}, [section]);

	const panels: Record<SettingsSection, ReactNode> = {
		...ompPanels(settings, cwd, editing, { path: openFile, open: setOpenFile, sectionHash: scope.kind === "all" ? hashForSettings : scope.sectionHash }),
		"omp-memory":
			settings.data === null ? (
				settingsReadNote(settings)
			) : (
				<OmpMemoryTab key={cwd ?? ""} active={section === "omp-memory"} settings={settings.data} editing={editing} onOpenFile={setOpenFile} />
			),
		analytics: <AnalyticsTab active={section === "analytics"} />,
		activity: <ActivityTab active={section === "activity"} />,
		providers: <ProvidersTab active={section === "providers"} />,
		preferences: <PreferencesTab cwd={cwd} workspace={cwd === null ? null : workspaceLabel(cwd, workspaces)} />,
		keyboard: <KeyboardTab />,
		integrations: <IntegrationsTab active={section === "integrations"} />,
		"mcp-servers": <McpServersTab active={section === "mcp-servers"} />,
		"source-control": <SourceControlTab active={section === "source-control"} />,
		workspaces: scope.kind === "all" && <WorkspacesTab workspaces={workspaces} list={scope.workspaceList} trustedProjects={scope.trustedProjects} />,
		sync: <SyncTab active={section === "sync"} />,
		phone: <PhoneAccessTab active={section === "phone"} />,
		storage: <StorageTab cwd={cwd} active={section === "storage"} onSaved={settings.reload} />,
		worktrees: <WorktreesTab cwd={cwd} active={section === "worktrees"} />,
		"whats-new": <WhatsNewTab />,
		decisions: <DecisionsTab cwd={cwd} workspaces={workspaces} active={section === "decisions"} />,
		extensions: <ExtensionsTab cwd={cwd} active={section === "extensions"} onSaved={settings.reload} />,
		modules: <ModulesTab />,
	};
	// Hidden panels stay mounted so an unsaved draft survives switching sections.
	const body = SETTINGS_SECTIONS.filter(({ value, group }) => value !== "extensions" && !(isPhonePage() && value === "phone") && (scope.kind === "all" || group === "workspace")).map(({ value, label }) => (
		<section key={value} aria-label={label} hidden={section !== value} tabIndex={0} className={PANEL}>
			{panels[value]}
		</section>
	));
	const shown = SETTINGS_SECTIONS.find(({ value }) => value === section)!;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{shown.group === "workspace" ? (
				<Header title={shown.label} meta={cwd === null ? shown.meta.none : shown.meta.workspace}>
					{scope.kind === "all" && <WorkspacePicker cwd={cwd} workspaces={workspaces} onPick={scope.onPickWorkspace} />}
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
