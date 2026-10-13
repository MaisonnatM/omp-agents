import { FolderOpen } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared/models";
import type { Workspace, WorkspaceList } from "../../../src/shared/workspaces";
import { settingsUrl } from "../../api";
import { useEditableRead } from "../../editable-read";
import { type ReadState, useRead } from "../../reads";
import { SETTINGS_SECTIONS, type SettingsSection } from "../../routing";
import { CommandPicker } from "../command-picker";
import { Header } from "../page-header";
import { AnalyticsTab } from "./analytics-tab";
import type { Catalog, Editing } from "./editor";
import { Files } from "./files-tab";
import { IntegrationsTab } from "./integrations-tab";
import { McpServersTab } from "./mcp-servers-tab";
import { PreferencesTab } from "./preferences-tab";
import { ProvidersTab } from "./providers-tab";
import { ModelsTab } from "./routing-tab";
import { SourceControlTab } from "./source-control-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { WorktreesTab } from "./worktrees-tab";

const workspaceLabel = (cwd: string, workspaces: Workspace[]): string => workspaces.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd;

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
						items: workspaces.map(workspace => ({
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

/** The omp sections' content once settings are read, else why they are empty. */
function ompPanels(read: ReadState<OmpSettings>, cwd: string | null, editing: Editing): Record<"models" | "files", ReactNode> {
	if (read.data === null) {
		const note =
			read.error === null ? (
				<p className="text-sm text-muted-foreground">Reading omp's settings…</p>
			) : (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Cannot read omp's settings: {read.error}
				</p>
			);
		return { models: note, files: note };
	}
	const { routing, files } = read.data;
	const filesPanel = <Files key={cwd ?? ""} files={files} editing={editing} />;
	if ("error" in routing) {
		const alert = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				omp cannot load its settings: {routing.error}
			</p>
		);
		return { models: alert, files: filesPanel };
	}
	const configPath = files.find(file => file.kind === "settings" && file.scope === "user" && file.path.endsWith("/config.yml"))?.pathDisplay;
	return {
		models: <ModelsTab routing={routing} configPath={configPath} editing={editing} />,
		files: filesPanel,
	};
}

/** One section of the settings: omp's usage, the dashboard's own choices, or omp's routing and files for one workspace or for the user only, each editable in place. */
export function SettingsPage({
	section,
	cwd,
	onPickWorkspace,
	workspaces,
	workspaceList,
	pins,
}: {
	section: SettingsSection;
	/** The sidebar's workspace, `null` for all workspaces, which reads your user files only. */
	cwd: string | null;
	onPickWorkspace: (cwd: string | null) => void;
	workspaces: Workspace[];
	workspaceList: WorkspaceList<Workspace>;
	pins: string[];
}) {
	const models = useRead<{ models: CatalogModel[] }>("/api/models");
	const catalog = useMemo(
		(): Catalog => ({
			data: models.data && {
				bySelector: new Map(models.data.models.map(model => [model.selector, model])),
				byProvider: Map.groupBy(models.data.models, model => model.provider),
			},
			error: models.error && `Cannot list omp's models: ${models.error}`,
		}),
		[models],
	);
	const settings = useEditableRead<OmpSettings>(settingsUrl("", cwd));
	const editing: Editing = { cwd, catalog, write: settings.write, reload: settings.reload };
	// Every section shares one scroller, so a newly opened one would start at the last one's offset.
	const scroller = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		scroller.current?.scrollTo({ top: 0 });
	}, [section]);

	const panels: Record<SettingsSection, ReactNode> = {
		...ompPanels(settings, cwd, editing),
		analytics: <AnalyticsTab active={section === "analytics"} />,
		providers: <ProvidersTab active={section === "providers"} />,
		preferences: <PreferencesTab cwd={cwd} workspace={cwd === null ? null : workspaceLabel(cwd, workspaces)} />,
		integrations: <IntegrationsTab active={section === "integrations"} />,
		"mcp-servers": <McpServersTab active={section === "mcp-servers"} />,
		"source-control": <SourceControlTab active={section === "source-control"} />,
		workspaces: <WorkspacesTab workspaces={workspaces} list={workspaceList} />,
		worktrees: <WorktreesTab cwd={cwd} active={section === "worktrees"} pins={pins} />,
	};
	// Hidden panels stay mounted so an unsaved draft survives switching sections.
	const body = SETTINGS_SECTIONS.map(({ value, label }) => (
		<section key={value} aria-label={label} hidden={section !== value} tabIndex={0} className={PANEL}>
			{panels[value]}
		</section>
	));
	const { label, scope } = SETTINGS_SECTIONS.find(({ value }) => value === section)!;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{scope === "workspace" ? (
				<Header title={label} meta={cwd === null ? "Your user files only, for all workspaces" : "As a session in this workspace loads them"}>
					<WorkspacePicker cwd={cwd} workspaces={workspaces} onPick={onPickWorkspace} />
				</Header>
			) : (
				<Header title={label} />
			)}
			<div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
			</div>
		</div>
	);
}
