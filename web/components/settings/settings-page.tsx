import { FolderOpen } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared/models";
import { settingsUrl } from "../../api";
import { type ReadState, useRead, useReplaceableRead } from "../../reads";
import { hashForSettings, SETTINGS_SECTIONS, type SettingsRoute, type SettingsSection } from "../../routing";
import { CommandPicker } from "../command-picker";
import { Header } from "../page-header";
import { AnalyticsTab } from "./analytics-tab";
import type { Catalog, Editing } from "./editor";
import { Files } from "./files-tab";
import { IntegrationsTab } from "./integrations-tab";
import { PreferencesTab } from "./preferences-tab";
import { ModelsTab } from "./routing-tab";
import { WorktreesTab } from "./worktrees-tab";

type Workspace = { cwd: string; cwdDisplay: string };

const workspaceLabel = (cwd: string, workspaces: Workspace[]): string => workspaces.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd;

function WorkspacePicker({ route: { section, cwd }, workspaces }: { route: SettingsRoute; workspaces: Workspace[] }) {
	const label = cwd === null ? "User files only" : workspaceLabel(cwd, workspaces);
	const pick = (next: string | null) => (): void => {
		location.hash = hashForSettings(section, next);
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
					{ key: "user", items: [{ value: "User files only", label: "User files only", selected: cwd === null, onSelect: pick(null) }] },
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
export function SettingsPage({ route, workspaces }: { route: SettingsRoute; workspaces: Workspace[] }) {
	const { section, cwd } = route;
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
	const [reads, setReads] = useState(0);
	const settings = useReplaceableRead<OmpSettings>(settingsUrl("", cwd), reads);
	const editing: Editing = { cwd, catalog, saved: settings.replace, reload: () => setReads(count => count + 1) };

	const panels: Record<SettingsSection, ReactNode> = {
		...ompPanels(settings, cwd, editing),
		analytics: <AnalyticsTab active={section === "analytics"} />,
		preferences: <PreferencesTab cwd={cwd} workspace={cwd === null ? null : workspaceLabel(cwd, workspaces)} />,
		integrations: <IntegrationsTab active={section === "integrations"} />,
		worktrees: <WorktreesTab cwd={cwd} active={section === "worktrees"} />,
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
				<Header title={label} meta={cwd === null ? "Your user files only" : "As a session in this workspace loads them"}>
					<WorkspacePicker route={route} workspaces={workspaces} />
				</Header>
			) : (
				<Header title={label} />
			)}
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-6">{body}</div>
			</div>
		</div>
	);
}
