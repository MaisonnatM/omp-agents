import { Tabs } from "@base-ui/react/tabs";
import { Check, ChevronsUpDown, FolderOpen } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CatalogModel, OmpSettings } from "../../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { hashForSettings } from "../../routing";
import { loadModels, loadSettings } from "../../settings-api";
import { Header } from "../conversation";
import { type Catalog, type Editing, errorText } from "./editor";
import { Files } from "./files-tab";
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

type SettingsTab = "roles" | "retry" | "files";

const SETTINGS_TABS: [SettingsTab, string][] = [
	["roles", "Model roles & provider order"],
	["retry", "Retry and fallback"],
	["files", "Files"],
];

const PANEL = "space-y-10 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background";

/** omp's model routing and the files it reads, for one workspace or for the user only, each editable in place. */
export function SettingsPage({ cwd, workspaces }: { cwd: string | null; workspaces: Workspace[] }) {
	const [load, setLoad] = useState<Load>({ phase: "loading" });
	// Kept across workspace switches, which remount the tabs while settings load.
	const [tab, setTab] = useState<SettingsTab>("roles");
	const [catalog, setCatalog] = useState<Catalog>({ phase: "loading" });
	// A save answered after the user switched workspace must not replace the new workspace's settings.
	const currentCwd = useRef(cwd);
	currentCwd.current = cwd;

	useEffect(() => {
		loadModels().then(
			models => {
				const byProvider = new Map<string, CatalogModel[]>();
				for (const model of models) byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
				setCatalog({ phase: "loaded", bySelector: new Map(models.map(model => [model.selector, model])), byProvider: [...byProvider] });
			},
			(err: unknown) => setCatalog({ phase: "failed", error: `Cannot list omp's models: ${errorText(err)}` }),
		);
	}, []);

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

	let body: ReactNode;
	if (load.phase === "loading") body = <p className="text-sm text-muted-foreground">Reading omp's settings…</p>;
	else if (load.phase === "failed") body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot read omp's settings: {load.error}</p>;
	else {
		const { routing, files } = load.settings;
		const configPath = files.find(file => file.kind === "settings" && file.scope === "user" && file.path.endsWith("/config.yml"))?.pathDisplay;
		const routingAlert = "error" in routing && (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				omp cannot load its settings: {routing.error}
			</p>
		);
		// Panels stay mounted so an unsaved draft survives switching tabs.
		body = (
			<Tabs.Root value={tab} onValueChange={value => setTab(value as SettingsTab)} className="space-y-6">
				<Tabs.List className="flex gap-1 border-b border-border">
					{SETTINGS_TABS.map(([value, label]) => (
						<Tabs.Tab
							key={value}
							value={value}
							className="-mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active]:border-foreground data-[active]:text-foreground"
						>
							{label}
						</Tabs.Tab>
					))}
				</Tabs.List>
				<Tabs.Panel value="roles" keepMounted className={PANEL}>
					{"error" in routing ? routingAlert : <RolesTab routing={routing} configPath={configPath} editing={editing} />}
				</Tabs.Panel>
				<Tabs.Panel value="retry" keepMounted className={PANEL}>
					{"error" in routing ? routingAlert : <RetrySection routing={routing} editing={editing} />}
				</Tabs.Panel>
				<Tabs.Panel value="files" keepMounted className={PANEL}>
					<Files key={cwd ?? ""} files={files} editing={editing} />
				</Tabs.Panel>
			</Tabs.Root>
		);
	}

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
