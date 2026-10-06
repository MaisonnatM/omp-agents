import { FileText, FolderOpen, GitBranch, Palette, Plug, RotateCcw, Route, Sparkles } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { settingsUrl } from "../../api";
import { type ReadState, useRead, useReplaceableRead } from "../../reads";
import { hashForSettings } from "../../routing";
import { CommandPicker } from "../command-picker";
import { Header } from "../page-header";
import { AppearanceTab } from "./appearance-tab";
import type { Catalog, Editing } from "./editor";
import { Files } from "./files-tab";
import { GoogleConnection } from "./google-connection";
import { LinearConnection } from "./linear-connection";
import { NewSessionsTab } from "./new-sessions-tab";
import { RetrySection, RolesTab } from "./routing-tab";
import { WorktreesTab } from "./worktrees-tab";

type Workspace = { cwd: string; cwdDisplay: string };

function WorkspacePicker({ cwd, workspaces }: { cwd: string | null; workspaces: Workspace[] }) {
	const label = cwd === null ? "User files only" : (workspaces.find(workspace => workspace.cwd === cwd)?.cwdDisplay ?? cwd);
	const pick = (next: string | null) => (): void => {
		location.hash = hashForSettings(next);
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

const SETTINGS_TABS = [
	{ value: "roles", label: "Model roles & provider order", icon: Route },
	{ value: "retry", label: "Retry and fallback", icon: RotateCcw },
	{ value: "files", label: "Files", icon: FileText },
	{ value: "worktrees", label: "Worktrees", icon: GitBranch },
	{ value: "integrations", label: "Integrations", icon: Plug },
	{ value: "new-sessions", label: "New sessions", icon: Sparkles },
	{ value: "appearance", label: "Appearance", icon: Palette },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

const PANEL = "space-y-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background data-[state=inactive]:hidden";

/** What the omp tabs show: their content once omp's settings are read, else why they are empty. */
function ompPanels(read: ReadState<OmpSettings>, cwd: string | null, editing: Editing): Record<"roles" | "retry" | "files", ReactNode> {
	if (read.data === null) {
		const note =
			read.error === null ? (
				<p className="text-sm text-muted-foreground">Reading omp's settings…</p>
			) : (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Cannot read omp's settings: {read.error}
				</p>
			);
		return { roles: note, retry: note, files: note };
	}
	const { routing, files } = read.data;
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
	const [tab, setTab] = useState<SettingsTab>("roles");
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

	const panels: Record<SettingsTab, ReactNode> = {
		...ompPanels(settings, cwd, editing),
		worktrees: <WorktreesTab cwd={cwd} active={tab === "worktrees"} />,
		integrations: <div className="space-y-6"><LinearConnection /><GoogleConnection /></div>,
		"new-sessions": <NewSessionsTab cwd={cwd} />,
		appearance: <AppearanceTab />,
	};
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
		<div className="flex h-full min-h-0 flex-1 flex-col">
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
