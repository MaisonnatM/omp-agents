import { Check, ChevronsUpDown, FileText, FolderOpen, Palette, Plug, RotateCcw, Route, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { errorText } from "../../api";
import { useRead } from "../../reads";
import { hashForSettings } from "../../routing";
import { loadSettings } from "../../settings-api";
import { Header } from "../conversation";
import { AppearanceTab } from "./appearance-tab";
import type { Catalog, Editing } from "./editor";
import { Files } from "./files-tab";
import { LinearConnection } from "./linear-connection";
import { NewSessionsTab } from "./new-sessions-tab";
import { RetrySection, RolesTab } from "./routing-tab";

type Load = { phase: "loading" } | { phase: "loaded"; settings: OmpSettings } | { phase: "failed"; error: string };

type Workspace = { cwd: string; cwdDisplay: string };

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

const SETTINGS_TABS = [
	{ value: "roles", label: "Model roles & provider order", icon: Route },
	{ value: "retry", label: "Retry and fallback", icon: RotateCcw },
	{ value: "files", label: "Files", icon: FileText },
	{ value: "integrations", label: "Integrations", icon: Plug },
	{ value: "new-sessions", label: "New sessions", icon: Sparkles },
	{ value: "appearance", label: "Appearance", icon: Palette },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

const PANEL = "space-y-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background data-[state=inactive]:hidden";

/** What the omp tabs show: their content once omp's settings are read, else why they are empty. */
function ompPanels(load: Load, cwd: string | null, editing: Editing): Record<"roles" | "retry" | "files", ReactNode> {
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
	const models = useRead<{ models: CatalogModel[] }>("/api/models");
	const catalog = useMemo((): Catalog => {
		if (models.error !== null) return { phase: "failed", error: `Cannot list omp's models: ${models.error}` };
		if (models.data === null) return { phase: "loading" };
		const byProvider = new Map<string, CatalogModel[]>();
		for (const model of models.data.models) {
			const listed = byProvider.get(model.provider);
			if (listed) listed.push(model);
			else byProvider.set(model.provider, [model]);
		}
		return { phase: "loaded", bySelector: new Map(models.data.models.map(model => [model.selector, model])), byProvider: [...byProvider] };
	}, [models]);
	// A save answered after the user switched workspace must not replace the new workspace's settings.
	const currentCwd = useRef(cwd);
	currentCwd.current = cwd;

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

	const panels: Record<SettingsTab, ReactNode> = {
		...ompPanels(load, cwd, editing),
		integrations: <LinearConnection />,
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
