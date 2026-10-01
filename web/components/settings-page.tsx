import { Check, ChevronsUpDown, FolderOpen } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { ModelRouting, OmpFile, OmpSettings, RetrySettings } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FILE_KIND_LABELS, fileGroups, hashForSettings, providerOrg } from "../view-model";
import { Header, Model } from "./conversation";
import { OrgIcon } from "./org-icon";

type Load = { phase: "loading" } | { phase: "loaded"; settings: OmpSettings } | { phase: "failed"; error: string };

type Workspace = { cwd: string; cwdDisplay: string };

const onOff = (value: boolean | number | string): string => (value ? "On" : "Off");
const duration = (value: boolean | number | string): string =>
	Number(value) < 1000 ? `${value} ms` : Number(value) < 60_000 ? `${Number(value) / 1000} s` : `${Number(value) / 60_000} min`;

/** `retry.*` rows in the order they matter for fallback, with omp's key and how each value reads. */
const RETRY_ROWS: [keyof RetrySettings, string, (value: boolean | number | string) => string][] = [
	["modelFallback", "Model fallback", onOff],
	["usageAwareFallback", "Usage-aware fallback", onOff],
	["usageReservePct", "Reserve margin", value => `${value}%`],
	["usageReservePolicy", "Reserve policy", String],
	["fallbackRevertPolicy", "Return to primary", String],
	["enabled", "Retry on API errors", onOff],
	["maxRetries", "Retry attempts", String],
	["baseDelayMs", "Base delay", duration],
	["maxDelayMs", "Max delay", value => (Number(value) === 0 ? "No ceiling" : duration(value))],
	["waitForUsageReset", "Wait for usage reset", onOff],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-semibold">{title}</h3>
			{children}
		</section>
	);
}

/** Fallbacks in the order omp tries them. */
function Chain({ fallbacks }: { fallbacks: string[] }) {
	if (fallbacks.length === 0) return <span className="text-muted-foreground">None</span>;
	return (
		<ol className="flex flex-wrap gap-x-4 gap-y-1">
			{fallbacks.map((selector, index) => (
				<li key={`${index}:${selector}`} className="flex items-baseline gap-1.5">
					<span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
					<Model selector={selector} />
				</li>
			))}
		</ol>
	);
}

function Routing({ routing }: { routing: ModelRouting }) {
	return (
		<>
			<Section title="Model roles">
				{routing.roles.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No roles are set. omp uses its own defaults until <code>modelRoles</code> names a model.
					</p>
				) : (
					<table className="w-full text-sm">
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th scope="col" className="pb-2 pr-6 font-medium">Role</th>
								<th scope="col" className="pb-2 pr-6 font-medium">Model</th>
								<th scope="col" className="pb-2 font-medium">Fallbacks, in order</th>
							</tr>
						</thead>
						<tbody>
							{routing.roles.map(route => (
								<tr key={route.role} className="border-t border-border align-baseline">
									<th scope="row" className="py-2 pr-6 text-left font-medium">{route.role}</th>
									<td className="whitespace-nowrap py-2 pr-6">
										{route.primary ? <Model selector={route.primary} /> : <span className="text-muted-foreground">Not set</span>}
									</td>
									<td className="py-2">
										<Chain fallbacks={route.fallbacks} />
										{route.inheritsDefault && <p className="mt-0.5 text-xs text-muted-foreground">The default role's chain</p>}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Section>
			{routing.modelChains.length > 0 && (
				<Section title="Chains for a model">
					<p className="text-xs text-muted-foreground">These apply whenever the model is active, whatever its role.</p>
					<table className="w-full text-sm">
						<tbody>
							{routing.modelChains.map(chain => (
								<tr key={chain.key} className="border-t border-border align-baseline">
									<th scope="row" className="py-2 pr-6 text-left font-mono text-xs font-medium">{chain.key}</th>
									<td className="py-2">
										<Chain fallbacks={chain.fallbacks} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Section>
			)}
			<div className="grid gap-10 md:grid-cols-2">
				<Section title="Retry and fallback">
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
						{RETRY_ROWS.map(([key, label, format]) => (
							<div key={key} className="contents">
								<dt className="text-muted-foreground" title={`retry.${key}`}>
									{label}
								</dt>
								<dd className="tabular-nums">{format(routing.retry[key])}</dd>
							</div>
						))}
					</dl>
				</Section>
				<Section title="Provider order">
					{routing.modelProviderOrder.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Not set. omp picks among providers that serve a model by its own order.
						</p>
					) : (
						<ol className="space-y-2 text-sm">
							{routing.modelProviderOrder.map((provider, index) => (
								<li key={provider} className="flex items-center gap-2">
									<span className="w-3 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
									<OrgIcon org={providerOrg(provider)} />
									{provider}
								</li>
							))}
						</ol>
					)}
				</Section>
			</div>
		</>
	);
}

function FileView({ file }: { file: OmpFile }) {
	const { body } = file;
	return (
		<div className="flex min-w-0 flex-col gap-2 self-start md:sticky md:top-6" role="region" aria-label={file.pathDisplay}>
			<p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
				<span className="font-mono text-foreground">{file.pathDisplay}</span>
				{body.state === "read" && (
					<>
						<span className="tabular-nums">{body.size < 1024 ? `${body.size} B` : `${(body.size / 1024).toFixed(1)} KB`}</span>
						<span>Changed {new Date(body.modifiedAt).toLocaleString()}</span>
					</>
				)}
			</p>
			{body.state === "read" ? (
				<pre
					tabIndex={0}
					className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{body.text || <span className="text-muted-foreground">The file is empty.</span>}
				</pre>
			) : (
				<p
					className={cn(
						"rounded-md border border-dashed border-border px-3 py-6 text-center text-sm",
						body.state === "unreadable" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
					)}
				>
					{body.state === "missing" ? "This file does not exist yet. omp reads it from this path once you create it." : `Cannot read this file: ${body.error}`}
				</p>
			)}
		</div>
	);
}

function Files({ files }: { files: OmpFile[] }) {
	const groups = fileGroups(files);
	const [selected, setSelected] = useState<string | null>(null);
	const open = files.find(file => file.path === selected) ?? groups[0]?.[1][0];
	if (!open) return <p className="text-sm text-muted-foreground">omp found no files.</p>;
	return (
		<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
			<nav aria-label="omp files" className="space-y-4">
				{groups.map(([kind, group]) => (
					<div key={kind} className="space-y-1">
						<h4 className="px-2 text-xs font-medium text-muted-foreground">{FILE_KIND_LABELS[kind]}</h4>
						<ul>
							{group.map(file => {
								const parts = file.path.split("/");
								// A skill's file is always SKILL.md; its directory names it.
								const name = parts.at(-1) === "SKILL.md" ? parts.at(-2) : parts.at(-1);
								return (
									<li key={file.path}>
										<button
											type="button"
											aria-current={file === open ? "true" : undefined}
											title={file.pathDisplay}
											onClick={() => setSelected(file.path)}
											className={cn(
												"flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
												file === open && "bg-muted font-medium",
											)}
										>
											<span className={cn("truncate", file.body.state !== "read" && "text-muted-foreground")}>{name}</span>
											<span className="ml-auto shrink-0 text-xs text-muted-foreground">
												{file.body.state === "missing" ? "missing" : file.scope === "project" ? "project" : ""}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				))}
			</nav>
			<FileView file={open} />
		</div>
	);
}

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

/** omp's model routing and the files it reads, for one workspace or for the user only. Read-only. */
export function SettingsPage({ cwd, workspaces }: { cwd: string | null; workspaces: Workspace[] }) {
	const [load, setLoad] = useState<Load>({ phase: "loading" });
	useEffect(() => {
		const controller = new AbortController();
		setLoad({ phase: "loading" });
		fetch(cwd === null ? "/api/settings" : `/api/settings?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal })
			.then(async response => {
				const body = (await response.json()) as OmpSettings | { error: string };
				setLoad("error" in body ? { phase: "failed", error: body.error } : { phase: "loaded", settings: body });
			})
			.catch((err: unknown) => {
				if (!controller.signal.aborted) setLoad({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
			});
		return () => controller.abort();
	}, [cwd]);

	let body: ReactNode;
	if (load.phase === "loading") body = <p className="text-sm text-muted-foreground">Reading omp's settings…</p>;
	else if (load.phase === "failed") body = <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot read omp's settings: {load.error}</p>;
	else {
		const { routing, files } = load.settings;
		body = (
			<>
				{"error" in routing ? (
					<p role="alert" className="text-sm text-red-600 dark:text-red-400">
						omp cannot load its settings: {routing.error}
					</p>
				) : (
					<Routing routing={routing} />
				)}
				<Section title="Files">
					<Files key={cwd ?? ""} files={files} />
				</Section>
			</>
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
