import { Blocks, CircleAlert, Package, Plus, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
	ExtensionCatalog,
	ExtensionCatalogEntry,
	ExtensionChange,
	ExtensionContribution,
	ExtensionKind,
	ExtensionOperation,
	ExtensionPackage,
	ExtensionsAnswer,
	ExtensionScope,
} from "../../../src/shared/extensions";
import { errorText } from "../../../src/json";
import { getJson, putJson, settingsUrl } from "../../api";
import { readTime } from "../../labels";
import { hashForSettings } from "../../routing";
import { useRead } from "../../reads";
import { useInlineConfirm } from "../../use-inline-confirm";
import { FormDialog, FormDialogHeader, ERROR_TEXT, isSubmitChord } from "../form-dialog";
import { Field, FIELD } from "../form-field";
import { Callout, IntegrationList } from "../integrations/integration-row";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { SearchField } from "../search-field";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";
import { ToggleSwitch } from "../toggle-switch";
import { Section } from "./editor";

import type { ReadOnlyFile } from "../../../src/shared/models";
import { FileView } from "./files-tab";

const packageKey = (pkg: ExtensionPackage): string => JSON.stringify(pkg.target);
const contributionKey = (item: ExtensionContribution): string => JSON.stringify([item.kind, item.provider, item.scope, item.path]);
const inventoryNote = (pkg: ExtensionPackage): string | null =>
	pkg.inventory === "unavailable"
		? "omp does not expose a static inventory for disabled or overridden package roots."
		: pkg.inventory === "undiscovered"
			? "No contributions discovered. Check the inventory warnings before treating this as empty."
			: null;
type View = "installed" | "discover" | "preview" | "sources";
type Confirmation = { title: string; detail: string; change: Exclude<ExtensionChange, { kind: "uninstall" | "source-remove" }> };
const KIND: Record<ExtensionKind, string> = { marketplace: "Marketplace plugin", plugin: "npm / linked plugin", "registry-skill": "Registry skill" };
const TABS: { value: View; label: string }[] = [
	{ value: "installed", label: "Installed" },
	{ value: "discover", label: "Discover" },
	{ value: "preview", label: "Preview" },
	{ value: "sources", label: "Sources" },
];

function Choice({
	id,
	label,
	value,
	options,
	onChange,
	inline = false,
}: {
	id: string;
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
	inline?: boolean;
}) {
	const control = (
		<Select
			value={value}
			onValueChange={(next) => {
				if (next !== null) onChange(next);
			}}
		>
			<SelectTrigger id={id} aria-label={inline ? label : undefined} className={inline ? "w-fit" : undefined}>
				<SelectValue>{options.find((option) => option.value === value)?.label ?? value}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
	return inline ? (
		control
	) : (
		<Field label={label} htmlFor={id}>
			{control}
		</Field>
	);
}

function Contributions({ items, onOpen }: { items: ExtensionContribution[]; onOpen: (item: ExtensionContribution) => void }) {
	return (
		<div className="space-y-5">
			{[...Map.groupBy(items, (item) => item.kind)].map(([kind, group]) => (
				<section key={kind} className="space-y-1">
					<h3 className="text-xs font-medium text-muted-foreground">
						{kind} · {group.length}
					</h3>
					<ul>
						{group.map((item) => (
							<li key={contributionKey(item)}>
								<button
									type="button"
									onClick={() => onOpen(item)}
									className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
								>
									<span className="min-w-0 flex-1 break-words text-sm">{item.name}</span>
									<span className="text-xs text-muted-foreground">{item.state}</span>
									<span className="w-full break-all font-mono text-xs text-muted-foreground">{item.path}</span>
									{item.invocation && <span className="font-mono text-xs">{item.invocation}</span>}
								</button>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

function PackageDetail({
	pkg,
	busy,
	onChange,
	onUninstall,
	onOpen,
	onClose,
	previous,
	next,
}: {
	pkg: ExtensionPackage;
	busy: boolean;
	onChange: (confirmation: Confirmation) => void;
	onUninstall: () => void;
	onOpen: (item: ExtensionContribution) => void;
	onClose: () => void;
	previous?: () => void;
	next?: () => void;
}) {
	const confirm = useInlineConfirm(packageKey(pkg));
	const switchable = pkg.target.kind === "registry-skill" ? null : pkg.target;
	return (
		<div>
			<DetailBar
				leading={`${KIND[pkg.target.kind]} · ${pkg.target.scope}`}
				previous={{ icon: CH_PREVIOUS, label: "Previous package", onClick: previous }}
				next={{ icon: CH_NEXT, label: "Next package", onClick: next }}
				close={{ icon: CH_CLOSE, label: "Close package", onClick: onClose }}
			/>
			<div className="space-y-6 p-6">
				<div className="space-y-2">
					<h2 className="break-words text-lg font-semibold">{pkg.name}</h2>
					{pkg.description && <p className="text-sm text-muted-foreground">{pkg.description}</p>}
					<p className="text-xs text-muted-foreground">
						{pkg.version ?? "Version not reported"}
						{pkg.range ? ` · Requested ${pkg.range}` : ""} · {pkg.source ?? (pkg.target.kind === "registry-skill" ? "Skill registry" : "npm, git, or linked package")}
					</p>
					<p className="break-all font-mono text-xs text-muted-foreground">{pkg.root ?? "Not stored locally"}</p>
					{!pkg.stored && <p className="text-sm text-amber-600 dark:text-amber-400">Files are missing. Update can restore the package from its source.</p>}
					{pkg.shadowedBy && (
						<p className="text-sm text-muted-foreground">Overridden by the project copy. Changing this user copy does not change the project copy.</p>
					)}
				</div>
				{pkg.availableVersion && (
					<p className="text-sm text-muted-foreground">
						Cached catalog update: {pkg.version} → {pkg.availableVersion}. Refresh the source to check for newer versions.
					</p>
				)}
				{pkg.target.kind === "plugin" && (
					<a href={hashForSettings("files")} className="text-xs text-foreground underline-offset-2 hover:underline">
						Inspect project plugin-overrides.json in Files
					</a>
				)}
				<div className="flex flex-wrap gap-2">
					{switchable && pkg.enabled !== null && (
						<Button
							size="compact"
							variant="outline"
							disabled={busy}
							onClick={() =>
								onChange({
									title: pkg.enabled ? "Disable package" : "Enable package",
									detail: `${pkg.name} · ${pkg.target.scope}. ${pkg.target.kind === "marketplace" ? "A project copy can override the user copy; disabling it can reveal the user copy." : "This changes the global plugin switch. A project's plugin-overrides.json may still override it."}`,
									change: { kind: "enabled", target: switchable, enabled: !pkg.enabled },
								})
							}
						>
							{pkg.enabled ? "Disable" : "Enable"}
						</Button>
					)}
					<>
						{pkg.updateNote ? (
							<p className="w-full text-xs text-muted-foreground">{pkg.updateNote}</p>
						) : (
							<Button
								size="compact"
								variant="outline"
								disabled={busy}
								onClick={() =>
									onChange({
										title: "Update package",
										detail: `${pkg.name} · ${pkg.target.scope} · ${pkg.version ?? "unknown version"}. ${pkg.target.kind === "registry-skill" ? `omp resolves the saved range ${pkg.range ?? "latest"} and restores missing files; it does not force a new major version.` : pkg.target.kind === "marketplace" ? "omp reinstalls the version in the cached marketplace catalog. Refresh the source first to fetch a newer catalog." : "omp updates from the original source. Linked packages have no registry update candidate."} Package installation may execute code.`,
										change: { kind: "update", target: pkg.target },
									})
								}
							>
								Update from source
							</Button>
						)}
					</>
					<Button
						size="compact"
						variant="destructive-outline"
						disabled={busy}
						aria-describedby={confirm.isArmed("uninstall") ? "extension-uninstall-scope" : undefined}
						{...confirm.props("uninstall", onUninstall)}
					>
						{confirm.isArmed("uninstall") ? "Confirm uninstall" : "Uninstall"}
					</Button>
					{confirm.isArmed("uninstall") && (
						<p id="extension-uninstall-scope" className="w-full text-xs text-muted-foreground">
							Remove {pkg.name} from {pkg.target.scope === "user" ? "all workspaces" : "this workspace"}. Other scope copies remain installed.
						</p>
					)}
				</div>
				<section className="space-y-3">
					<h3 className="text-sm font-medium">Contributions</h3>
					<p className="text-xs text-muted-foreground">
						Workspace preview, not a running session's inventory. Declared module files have not been executed for this preview.
					</p>
					{inventoryNote(pkg) && <p className="text-sm text-muted-foreground">{inventoryNote(pkg)}</p>}
					<Contributions items={pkg.contributions} onOpen={onOpen} />
				</section>
			</div>
		</div>
	);
}

function InstallDialog({
	cwd,
	snapshot,
	entry,
	busy,
	onClose,
	onConfirm,
}: {
	cwd: string | null;
	snapshot: ExtensionsAnswer;
	entry: ExtensionCatalogEntry | null;
	busy: boolean;
	onClose: () => void;
	onConfirm: (value: Confirmation) => void;
}) {
	const id = useId();
	const [kind, setKind] = useState<ExtensionKind>(entry?.kind ?? "plugin");
	const [spec, setSpec] = useState(entry?.id ?? "");
	const [source, setSource] = useState(entry?.kind === "marketplace" ? entry.source : (snapshot.sources[0]?.name ?? ""));
	const [linked, setLinked] = useState(false);
	const [scope, setScope] = useState<ExtensionScope>(cwd ? "project" : "user");
	const targetScope = kind === "plugin" ? "user" : scope;
	const target =
		targetScope === "user"
			? snapshot.userTargets[kind === "registry-skill" ? "skills" : "plugins"]
			: snapshot.projectTarget
				? `${snapshot.projectTarget}${kind === "marketplace" ? "/plugins" : ""}`
				: null;
	return (
		<FormDialog busy={busy} onClose={onClose} className="top-[12vh] w-[min(36rem,calc(100vw-2rem))]">
			<FormDialogHeader title="Install extension" busy={busy} />
			<form
				className="space-y-5 p-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (busy) return;
					if (!spec.trim()) return;
					onConfirm({
						title: linked && kind === "plugin" ? "Link extension" : "Install extension",
						detail: `${spec} ${entry?.version ? `· Catalog version ${entry.version}` : "· Version resolved by omp"}.\nTarget: ${target ?? "omp's selected workspace configuration"} (${targetScope}).${kind === "registry-skill" ? `\nRegistry: ${snapshot.registry.url}` : ""}\nPlugins can execute code with your account's permissions. This does not grant project trust or reload running sessions.`,
						change:
							kind === "plugin"
								? { kind: "install", packageKind: kind, spec, source: linked ? "link" : source, scope: "user" }
								: { kind: "install", packageKind: kind, spec, source, scope: targetScope },
					});
				}}
				onKeyDown={(event) => {
					if (isSubmitChord(event)) {
						event.preventDefault();
						if (!busy) event.currentTarget.requestSubmit();
					}
				}}
			>
				<Choice
					id={`${id}-kind`}
					label="Package kind"
					value={kind}
					options={Object.entries(KIND).map(([value, label]) => ({ value, label }))}
					onChange={(value) => setKind(value as ExtensionKind)}
				/>
				{kind === "plugin" && (
					<Choice
						id={`${id}-method`}
						label="Install method"
						value={linked ? "link" : "package"}
						options={[
							{ value: "package", label: "npm or git package" },
							{ value: "link", label: "Link local directory" },
						]}
						onChange={(value) => setLinked(value === "link")}
					/>
				)}
				<Field
					label={kind === "registry-skill" ? "Skill package" : kind === "marketplace" ? "Plugin name" : linked ? "Local directory" : "npm or git package"}
					htmlFor={`${id}-spec`}
					hint={
						kind === "registry-skill"
							? "Use @scope/name with an optional @version or @range."
							: kind === "plugin"
								? "Use a package spec or local directory accepted by omp."
								: "Use the plugin's name in this marketplace."
					}
				>
					<input
						id={`${id}-spec`}
						required
						autoFocus
						className={`${FIELD} w-full`}
						value={spec}
						onChange={(event) => setSpec(event.target.value)}
						placeholder={kind === "registry-skill" ? "@scope/name@^1" : linked ? "/path/to/plugin" : kind === "plugin" ? "@scope/plugin@1.0.0" : "plugin-name"}
					/>
				</Field>
				{kind === "marketplace" && (
					<Choice
						id={`${id}-source`}
						label="Marketplace"
						value={source}
						options={snapshot.sources.map((source) => ({ value: source.name, label: source.name }))}
						onChange={setSource}
					/>
				)}
				{kind !== "plugin" && cwd !== null && (
					<Choice
						id={`${id}-scope`}
						label="Install for"
						value={scope}
						options={[
							{ value: "project", label: "This workspace" },
							{ value: "user", label: "All workspaces" },
						]}
						onChange={(value) => setScope(value as ExtensionScope)}
					/>
				)}
				<p className="break-all font-mono text-xs text-muted-foreground">{target ?? "Pick a workspace with an omp project directory."}</p>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" size="compact" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" size="compact" disabled={busy}>
						Review install
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}

export function ExtensionsTab({ cwd, active, onSaved }: { cwd: string | null; active: boolean; onSaved: () => void }) {
	const id = useId();
	const [view, setView] = useState<View>("installed");
	const [version, setVersion] = useState(0);
	const read = useRead<ExtensionsAnswer>(active ? settingsUrl("/extensions", cwd) : null, version);
	const snapshot = read.data;
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState("all");
	const [scopeFilter, setScopeFilter] = useState("all");
	const [sourceFilter, setSourceFilter] = useState("all");
	const [selected, setSelected] = useState<string | null>(null);
	const [catalogSource, setCatalogSource] = useState("marketplaces");
	const [catalogRequest, setCatalogRequest] = useState<{ cwd: string | null; url: string; version: number } | null>(null);
	const catalog = useRead<ExtensionCatalog>(catalogRequest?.cwd === cwd ? catalogRequest.url : null, catalogRequest?.version);
	const [catalogSelected, setCatalogSelected] = useState<string | null>(null);
	const [install, setInstall] = useState<{ entry: ExtensionCatalogEntry | null } | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [job, setJob] = useState<{ cwd: string | null; value: ExtensionOperation } | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pollFailed, setPollFailed] = useState(false);
	const [preview, setPreview] = useState<ExtensionContribution | null>(null);
	const previewRead = useRead<ReadOnlyFile>(
		preview ? settingsUrl("/extensions/contribution", cwd, { kind: preview.kind, path: preview.path, provider: preview.provider, scope: preview.scope }) : null,
	);
	const [source, setSource] = useState("");
	const [registryUrl, setRegistryUrl] = useState<string | null>(null);
	const armed = useInlineConfirm(cwd ?? "user");
	const busy = sending || job?.value.state === "working" || job?.value.state === "needs-approval";
	useEffect(() => {
		setSelected(null);
		setCatalogSelected(null);
		setPreview(null);
		setConfirmation(null);
		setInstall(null);
		setRegistryUrl(null);
		setScopeFilter("all");
		setSourceFilter("all");
	}, [cwd]);
	useEffect(() => {
		if (!job || (job.value.state !== "working" && job.value.state !== "needs-approval")) return;
		let stopped = false;
		const timer = setTimeout(async () => {
			try {
				const value = await getJson<ExtensionOperation>(settingsUrl("/extensions/operation", job.cwd, { id: job.value.id }));
				if (stopped) return;
				setJob({ cwd: job.cwd, value });
				if (value.state === "done" || value.state === "failed") {
					setVersion((value) => value + 1);
					setCatalogRequest(null);
					onSaved();
				}
			} catch (err) {
				if (!stopped) {
					setError(errorText(err));
					setPollFailed(true);
				}
			}
		}, 700);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [job, onSaved]);
	async function send(change: ExtensionChange) {
		setSending(true);
		setError(null);
		setPollFailed(false);
		try {
			const value = await putJson<ExtensionOperation>(settingsUrl("/extensions", cwd), change);
			setJob({ cwd, value });
			setConfirmation(null);
			setInstall(null);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSending(false);
		}
	}
	async function approve(approved: boolean) {
		if (job?.value.state !== "needs-approval") return;
		setSending(true);
		setError(null);
		try {
			const value = await putJson<ExtensionOperation>(settingsUrl("/extensions/approval", job.cwd), {
				id: job.value.id,
				token: job.value.approval.token,
				approved,
			});
			setJob({ cwd: job.cwd, value });
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSending(false);
		}
	}
	const packages = (snapshot?.packages ?? []).filter(
		(pkg) =>
			(kind === "all" || pkg.target.kind === kind) &&
			(scopeFilter === "all" || pkg.target.scope === scopeFilter) &&
			(sourceFilter === "all" || pkg.source === sourceFilter) &&
			`${pkg.name} ${pkg.source} ${pkg.description} ${pkg.target.scope}`.toLowerCase().includes(query.toLowerCase()),
	);
	const filtered = query !== "" || kind !== "all" || scopeFilter !== "all" || sourceFilter !== "all";
	const open = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
	const index = open ? packages.indexOf(open) : -1;
	const catalogOpen = catalog.data?.entries.find((entry) => entry.key === catalogSelected) ?? null;
	const catalogIndex = catalog.data?.entries.findIndex((entry) => entry.key === catalogSelected) ?? -1;
	const discoveredItems = (snapshot?.items ?? []).filter((item) =>
		`${item.name} ${item.path} ${item.kind} ${item.provider} ${item.state}`.toLowerCase().includes(query.toLowerCase()),
	);
	const refreshCatalog = (page = 1) =>
		setCatalogRequest({
			cwd,
			url: settingsUrl("/extensions/catalog", cwd, { source: catalogSource === "marketplaces" ? "" : "registry", q: query, page: String(page) }),
			version: (catalogRequest?.version ?? 0) + 1,
		});
	return (
		<div className="flex h-full min-h-0 flex-col">
			<SegmentedTabs value={view} onValueChange={(value) => setView(value as View)} className="flex h-full min-h-0 flex-col">
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
					<SegmentedTabsList aria-label="Extension library" className="max-w-full overflow-x-auto">
						{TABS.map((tab) => (
							<SegmentedTab key={tab.value} value={tab.value}>
								{tab.label}
							</SegmentedTab>
						))}
					</SegmentedTabsList>
					<div className="flex flex-wrap gap-2">
						<Button
							size="compact"
							variant="ghost"
							leadingIcon={RefreshCw}
							loading={read.refreshing}
							disabled={busy}
							onClick={() => {
								setVersion((value) => value + 1);
								setCatalogRequest(null);
							}}
						>
							Refresh
						</Button>
						<Button size="compact" variant="secondary" leadingIcon={Plus} disabled={busy} onClick={() => setInstall({ entry: null })}>
							Install package
						</Button>
						<Button size="compact" variant="outline" render={<a href="#get-started" />}>
							Starter kit setup
						</Button>
					</div>
				</div>
				<div className="shrink-0 space-y-2 px-4 py-3">
					<p className="text-xs text-muted-foreground">
						Installed packages and the selected workspace's discovery preview. This does not inspect running sessions. Start a new session after changes;
						/reload-plugins only refreshes skills and commands.
					</p>
					{read.error && (
						<p role="alert" className={ERROR_TEXT}>
							{read.error}
						</p>
					)}
					{error && (
						<p role="alert" className={ERROR_TEXT}>
							{error}
						</p>
					)}
					{snapshot && snapshot.diagnostics.length > 0 && (
						<Callout tone="warning" icon={CircleAlert}>
							<details>
								<summary className="cursor-pointer">{snapshot.diagnostics.length} inventory warnings</summary>
								<ul className="space-y-1 pt-2">
									{snapshot.diagnostics.map((message, i) => (
										<li key={`${i}:${message}`} className="break-words">
											{message}
										</li>
									))}
								</ul>
							</details>
						</Callout>
					)}
					<div role="status" className="space-y-1 text-xs">
						{job && (
							<>
								<p className={job.value.state === "failed" ? ERROR_TEXT : "text-muted-foreground"}>
									{job.value.state === "working"
										? "omp is applying the change…"
										: job.value.state === "needs-approval"
											? "Waiting for script approval."
											: job.value.state === "done"
												? job.value.message
												: job.value.error}
								</p>
								{job.value.warnings.map((warning, i) => (
									<p key={i}>{warning}</p>
								))}
								{(job.value.state === "working" || job.value.state === "needs-approval") && (
									<span
										role="progressbar"
										aria-label="Extension change"
										aria-valuetext={job.value.state === "needs-approval" ? "Waiting for script approval" : "Applying native change"}
										className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
									>
										<span className="block h-full w-full rounded-full bg-emerald-500 motion-safe:animate-pulse" />
									</span>
								)}
							</>
						)}
					</div>
					{job && <p className="break-all text-xs text-muted-foreground">Operation scope: {job.cwd ?? "User · all workspaces"}</p>}
					{pollFailed && job && (
						<Button
							size="compact"
							variant="outline"
							onClick={() => {
								setError(null);
								setPollFailed(false);
								setJob({ ...job });
							}}
						>
							Check operation
						</Button>
					)}
				</div>
				{(view === "installed" || view === "preview") && (
					<div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 pb-3">
						<SearchField
							label="Search extensions"
							placeholder={view === "installed" ? "Search packages…" : "Search contributions…"}
							query={query}
							onQuery={setQuery}
							className="min-w-32 flex-1"
						/>
						{view === "installed" && (
							<>
								<Choice
									inline
									id={`${id}-filter`}
									label="Package kind"
									value={kind}
									options={[{ value: "all", label: "All packages" }, ...Object.entries(KIND).map(([value, label]) => ({ value, label }))]}
									onChange={setKind}
								/>
								<Choice
									inline
									id={`${id}-scope`}
									label="Scope"
									value={scopeFilter}
									options={[{ value: "all", label: "All scopes" }, { value: "user", label: "User" }, ...(cwd ? [{ value: "project", label: "Project" }] : [])]}
									onChange={setScopeFilter}
								/>
								<Choice
									inline
									id={`${id}-source-filter`}
									label="Source"
									value={sourceFilter}
									options={[
										{ value: "all", label: "All sources" },
										...[...new Set(snapshot?.packages.flatMap((pkg) => (pkg.source ? [pkg.source] : [])) ?? [])].map((value) => ({ value, label: value })),
									]}
									onChange={setSourceFilter}
								/>
							</>
						)}
					</div>
				)}
				<SegmentedTabPanel value="installed" className="min-h-0 flex-1 outline-none">
					<ListSplit
						widthKey="omp-agents.extensions-split"
						resizeLabel="Resize the extension list"
						detailLabel="Open extension"
						empty={{ icon: Package, title: "Select a package", hint: "Read its contributions or manage its installation." }}
						list={
							<div className="p-2">
								{read.data === null && !read.error ? (
									<p className="p-4 text-sm text-muted-foreground">Reading installed packages…</p>
								) : packages.length === 0 ? (
									<div className="space-y-2 p-4 text-sm">
										<p>{filtered ? "No packages match these filters." : "No packages installed."}</p>
										{filtered ? (
											<Button
												size="compact"
												variant="outline"
												onClick={() => {
													setQuery("");
													setKind("all");
													setScopeFilter("all");
													setSourceFilter("all");
												}}
											>
												Clear filters
											</Button>
										) : (
											<>
												<p className="text-muted-foreground">Use Discover to browse a marketplace or registry, or install by package name.</p>
												<Button size="compact" variant="outline" onClick={() => setView("discover")}>
													Browse packages
												</Button>
											</>
										)}
									</div>
								) : (
									<ul aria-label="Installed packages">
										{packages.map((pkg) => (
											<li key={packageKey(pkg)}>
												<button
													type="button"
													aria-current={packageKey(pkg) === selected ? "true" : undefined}
													onClick={() => setSelected(packageKey(pkg))}
													className={cn(
														"w-full space-y-1 rounded-md p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
														selected === packageKey(pkg) && "bg-accent",
													)}
												>
													<span className="flex flex-wrap items-baseline justify-between gap-2">
														<span className="break-words text-sm font-medium">{pkg.name}</span>
														<span className="text-xs text-muted-foreground">{pkg.target.scope}</span>
													</span>
													<span className="block text-xs text-muted-foreground">
														{KIND[pkg.target.kind]} · {pkg.version ?? "unversioned"}
													</span>
													<span className="block text-xs text-muted-foreground">
														{pkg.enabled === false
															? "Disabled"
															: pkg.shadowedBy
																? "Overridden by project"
																: !pkg.stored
																	? "Files missing"
																	: inventoryNote(pkg)
																		? "Inventory incomplete"
																		: `${pkg.contributions.length} discovered / declared contributions`}
													</span>
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						}
						detail={
							open ? (
								<PackageDetail
									key={packageKey(open)}
									pkg={open}
									busy={busy}
									onChange={setConfirmation}
									onUninstall={() => void send({ kind: "uninstall", target: open.target })}
									onOpen={setPreview}
									onClose={() => setSelected(null)}
									previous={index > 0 ? () => setSelected(packageKey(packages[index - 1]!)) : undefined}
									next={index + 1 < packages.length ? () => setSelected(packageKey(packages[index + 1]!)) : undefined}
								/>
							) : null
						}
					/>
				</SegmentedTabPanel>
				<SegmentedTabPanel value="discover" className="flex min-h-0 flex-1 flex-col outline-none">
					<form
						className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 pb-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!catalog.refreshing) refreshCatalog();
						}}
						onKeyDown={(event) => {
							if (isSubmitChord(event)) {
								event.preventDefault();
								if (!catalog.refreshing) event.currentTarget.requestSubmit();
							}
						}}
					>
						<Choice
							inline
							id={`${id}-catalog`}
							label="Catalog"
							value={catalogSource}
							options={[
								{ value: "marketplaces", label: "Marketplace plugins" },
								{ value: "registry", label: "Registry skills" },
							]}
							onChange={(value) => {
								setCatalogSource(value);
								setCatalogRequest(null);
								setCatalogSelected(null);
							}}
						/>
						<SearchField label="Search catalog" placeholder="Search packages…" query={query} onQuery={setQuery} />
						<Button size="compact" variant="outline" disabled={catalog.refreshing}>
							{catalogSource === "registry" ? "Search registry" : "Read cached catalogs"}
						</Button>
					</form>
					{catalog.error && (
						<p role="alert" className={`${ERROR_TEXT} px-4 py-2`}>
							{catalog.error}
						</p>
					)}
					<ListSplit
						widthKey="omp-agents.extensions-discover-split"
						resizeLabel="Resize the catalog list"
						detailLabel="Open catalog package"
						empty={{ icon: Blocks, title: "Select a catalog package", hint: "Review the package before installing it." }}
						list={
							<div className="p-2">
								{!catalogRequest && (
									<p className="p-4 text-sm text-muted-foreground">
										Search the skill registry explicitly, or read your marketplaces' cached catalogs. Refresh a marketplace in Sources to fetch its latest
										catalog.
									</p>
								)}
								{catalog.data?.diagnostics.map((message, i) => (
									<p key={i} className={`${ERROR_TEXT} p-3`}>
										{message}
									</p>
								))}
								{catalog.data && catalog.data.entries.length === 0 && (
									<p className="p-4 text-sm text-muted-foreground">No packages found. Try a different search or add a marketplace in Sources.</p>
								)}
								<ul aria-label="Catalog results">
									{catalog.data?.entries.map((entry) => (
										<li key={entry.key}>
											<button
												type="button"
												aria-current={catalogSelected === entry.key ? "true" : undefined}
												onClick={() => setCatalogSelected(entry.key)}
												className={cn(
													"w-full space-y-1 rounded-md p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
													catalogSelected === entry.key && "bg-accent",
												)}
											>
												<span className="block text-sm font-medium">{entry.name}</span>
												<span className="block text-xs text-muted-foreground">
													{entry.source} · {entry.version ?? "Version not declared"}
												</span>
												<span className="line-clamp-2 block text-xs text-muted-foreground">{entry.description}</span>
											</button>
										</li>
									))}
								</ul>
								{catalog.data && (
									<div className="flex items-center justify-between gap-3 p-3">
										<Button
											size="compact"
											variant="outline"
											disabled={catalog.data.page <= 1 || catalog.refreshing}
											onClick={() => refreshCatalog(catalog.data!.page - 1)}
										>
											Previous page
										</Button>
										<span className="text-xs text-muted-foreground">Page {catalog.data.page}</span>
										<Button
											size="compact"
											variant="outline"
											disabled={!catalog.data.more || catalog.refreshing}
											onClick={() => refreshCatalog(catalog.data!.page + 1)}
										>
											Next page
										</Button>
									</div>
								)}
							</div>
						}
						detail={
							catalogOpen ? (
								<div key={catalogOpen.key}>
									<DetailBar
										leading={KIND[catalogOpen.kind]}
										previous={{
											icon: CH_PREVIOUS,
											label: "Previous catalog package",
											onClick: catalogIndex > 0 ? () => setCatalogSelected(catalog.data!.entries[catalogIndex - 1]!.key) : undefined,
										}}
										next={{
											icon: CH_NEXT,
											label: "Next catalog package",
											onClick:
												catalog.data && catalogIndex + 1 < catalog.data.entries.length
													? () => setCatalogSelected(catalog.data!.entries[catalogIndex + 1]!.key)
													: undefined,
										}}
										close={{ icon: CH_CLOSE, label: "Close catalog package", onClick: () => setCatalogSelected(null) }}
									/>
									<div className="space-y-5 p-6">
										<h2 className="break-words text-lg font-semibold">{catalogOpen.name}</h2>
										<p className="text-sm text-muted-foreground">{catalogOpen.description}</p>
										<p className="text-xs text-muted-foreground">
											{catalogOpen.source} · {catalogOpen.version ?? "Version not declared"}
										</p>
										<p className="text-sm text-muted-foreground">Contribution details available after installation.</p>
										<Button size="compact" disabled={busy} onClick={() => setInstall({ entry: catalogOpen })}>
											Review install
										</Button>
									</div>
								</div>
							) : null
						}
					/>
				</SegmentedTabPanel>
				<SegmentedTabPanel value="preview" className="min-h-0 flex-1 overflow-y-auto outline-none">
					<div className="mx-auto max-w-5xl space-y-8 px-6 py-6">
						<Section
							title="Workspace preview"
							meta="Available means omp's discovery selected the item for this workspace. It does not mean a running session loaded it. Paths, kinds, scopes, and shadowed copies stay separate."
						>
							<Contributions items={discoveredItems} onOpen={setPreview} />
							{discoveredItems.length === 0 && <p className="text-sm text-muted-foreground">No contributions match this search.</p>}
						</Section>
						<Section
							title="Discovery providers"
							meta="Provider switches save globally. A workspace configuration can override them. Foreign user sources are opt-in separately from the provider's project sources."
						>
							<IntegrationList label="Discovery providers">
								{snapshot?.providers.map((provider) => (
									<li key={provider.id} className="space-y-3 p-4">
										<div className="space-y-1">
											<h4 className="text-sm font-medium">{provider.name}</h4>
											<p className="text-xs text-muted-foreground">{provider.description}</p>
										</div>
										<div className="flex flex-wrap gap-x-6 gap-y-3 text-xs">
											<label className="flex items-center gap-2">
												<ToggleSwitch
													aria-label={`Enable provider ${provider.name}`}
													checked={provider.enabled}
													disabled={busy}
													onCheckedChange={(enabled) =>
														setConfirmation({
															title: enabled ? "Enable provider" : "Disable provider",
															detail: `${provider.name}: change the global discovery-provider switch. Existing sessions are not reloaded.`,
															change: { kind: "provider", id: provider.id, enabled, userOnly: false },
														})
													}
												/>
												Enable provider
											</label>
											{provider.foreign && (
												<label className="flex items-center gap-2">
													<ToggleSwitch
														aria-label={`Read user sources from ${provider.name}`}
														checked={provider.userEnabled}
														disabled={busy}
														onCheckedChange={(enabled) =>
															setConfirmation({
																title: enabled ? "Read user sources" : "Stop reading user sources",
																detail: `${provider.name}: change the separate global opt-in for this provider's user-level sources.`,
																change: { kind: "provider", id: provider.id, enabled, userOnly: true },
															})
														}
													/>
													Read user sources
												</label>
											)}
										</div>
									</li>
								))}
							</IntegrationList>
						</Section>
					</div>
				</SegmentedTabPanel>
				<SegmentedTabPanel value="sources" className="min-h-0 flex-1 overflow-y-auto outline-none">
					<div className="mx-auto max-w-5xl space-y-8 px-6 py-6">
						<Section title="Marketplaces" meta="Adding or refreshing a source fetches its catalog. Removing a source keeps its installed packages.">
							<IntegrationList label="Marketplaces">
								{snapshot?.sources.map((entry) => (
									<li key={entry.name} className="flex flex-wrap items-center gap-3 p-4">
										<div className="min-w-0 flex-1 space-y-1">
											<h4 className="text-sm font-medium">{entry.name}</h4>
											<p className="break-all font-mono text-xs text-muted-foreground">{entry.sourceUri}</p>
											<p className="text-xs text-muted-foreground">
												{entry.updatedAt ? `Last refreshed ${readTime(Date.parse(entry.updatedAt))}` : "Last refresh not recorded"}
											</p>
										</div>
										<Button
											size="compact"
											variant="outline"
											disabled={busy}
											onClick={() =>
												setConfirmation({
													title: "Refresh marketplace",
													detail: `Fetch the latest catalog from ${entry.sourceUri}. Installed packages are not updated.`,
													change: { kind: "source-refresh", name: entry.name },
												})
											}
										>
											Refresh catalog
										</Button>
										<Button
											size="compact"
											variant="destructive-outline"
											disabled={busy}
											{...armed.props(`source:${entry.name}`, () => void send({ kind: "source-remove", name: entry.name }))}
										>
											{armed.isArmed(`source:${entry.name}`) ? "Confirm remove" : "Remove"}
										</Button>
									</li>
								))}
							</IntegrationList>
							<form
								className="space-y-3"
								onSubmit={(event) => {
									event.preventDefault();
									if (!busy)
										setConfirmation({
											title: "Add marketplace",
											detail: `Fetch a catalog from ${source}. This does not install any package.`,
											change: { kind: "source-add", source },
										});
								}}
								onKeyDown={(event) => {
									if (isSubmitChord(event)) {
										event.preventDefault();
										if (!busy) event.currentTarget.requestSubmit();
									}
								}}
							>
								<Field
									label="Marketplace source"
									htmlFor={`${id}-source`}
									hint="Use a GitHub owner/repository, git URL, or local catalog path accepted by omp."
								>
									<input
										id={`${id}-source`}
										required
										className={`${FIELD} w-full`}
										value={source}
										onChange={(event) => setSource(event.target.value)}
										placeholder="owner/repository"
									/>
								</Field>
								<Button size="compact" variant="outline" disabled={busy}>
									Add marketplace
								</Button>
							</form>
						</Section>
						<Section title="Skill registry">
							<p className="break-all text-sm text-muted-foreground">Effective: {snapshot?.registry.url ?? "Reading…"}</p>
							{snapshot?.registry.overridden && (
								<p className="text-xs text-muted-foreground">
									This workspace overrides the global registry {snapshot.registry.global}. Saving below changes the global value only.
								</p>
							)}
							<form
								className="space-y-3"
								onSubmit={(event) => {
									event.preventDefault();
									if (!busy)
										setConfirmation({
											title: "Save registry URL",
											detail: `Use ${registryUrl ?? snapshot?.registry.global} for global skill-registry requests. A workspace override still wins.`,
											change: { kind: "registry", url: registryUrl ?? snapshot?.registry.global ?? "" },
										});
								}}
								onKeyDown={(event) => {
									if (isSubmitChord(event)) {
										event.preventDefault();
										if (!busy) event.currentTarget.requestSubmit();
									}
								}}
							>
								<Field label="Global registry URL" htmlFor={`${id}-registry`}>
									<input
										type="url"
										id={`${id}-registry`}
										required
										className={`${FIELD} w-full`}
										value={registryUrl ?? snapshot?.registry.global ?? ""}
										onChange={(event) => setRegistryUrl(event.target.value)}
									/>
								</Field>
								<Button size="compact" variant="outline" disabled={busy}>
									Save registry URL
								</Button>
							</form>
						</Section>
					</div>
				</SegmentedTabPanel>
			</SegmentedTabs>
			{install && snapshot && !confirmation && (
				<InstallDialog
					key={`${cwd}:${install.entry?.key ?? "new"}`}
					cwd={cwd}
					snapshot={snapshot}
					entry={install.entry}
					busy={busy}
					onClose={() => setInstall(null)}
					onConfirm={setConfirmation}
				/>
			)}
			{confirmation && (
				<FormDialog busy={sending} onClose={() => setConfirmation(null)} className="top-[15vh] w-[min(32rem,calc(100vw-2rem))]">
					<FormDialogHeader title={confirmation.title} busy={sending} />
					<div className="space-y-5 p-4">
						<p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{confirmation.detail}</p>
						{error && (
							<p role="alert" className={ERROR_TEXT}>
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2">
							<Button size="compact" variant="outline" disabled={sending} onClick={() => setConfirmation(null)}>
								Cancel
							</Button>
							<Button size="compact" disabled={busy} onClick={() => void send(confirmation.change)}>
								{sending ? "Applying…" : confirmation.title}
							</Button>
						</div>
					</div>
				</FormDialog>
			)}
			{job?.value.state === "needs-approval" && (
				<FormDialog busy={sending} onClose={() => void approve(false)} className="top-[10vh] w-[min(40rem,calc(100vw-2rem))]">
					<FormDialogHeader title="Allow skill scripts" busy={sending} />
					<div className="space-y-4 p-4">
						<p className="text-sm">
							{job.value.approval.id}@{job.value.approval.version} contains scripts.
						</p>
						<p className="text-sm text-muted-foreground">
							Approve only if you trust this exact package and version. Script execution has your account's permissions. Declining is passed to omp's installer.
							This request expires after ten minutes.
						</p>
						<ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
							{job.value.approval.files.map((file) => (
								<li key={file.path} className="break-all">
									{file.path}
									{file.executable ? " · executable" : ""}
								</li>
							))}
						</ul>
						{error && (
							<p role="alert" className={ERROR_TEXT}>
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2">
							<Button size="compact" variant="outline" disabled={sending} onClick={() => void approve(false)}>
								Decline scripts
							</Button>
							<Button size="compact" disabled={sending} onClick={() => void approve(true)}>
								Allow these scripts
							</Button>
						</div>
					</div>
				</FormDialog>
			)}
			{preview && (
				<FormDialog busy={false} onClose={() => setPreview(null)} className="top-[5vh] w-[min(60rem,calc(100vw-2rem))]">
					<FormDialogHeader title={preview.name} busy={false} />
					<div className="space-y-4 p-4">
						<p className="break-all font-mono text-xs text-muted-foreground">{preview.path}</p>
						<p className="text-xs text-muted-foreground">
							Read-only contribution · {preview.kind} · {preview.scope} · {preview.state}
						</p>
						{snapshot?.packages.some(
							(pkg) => pkg.target.kind === "registry-skill" && pkg.contributions.some((item) => contributionKey(item) === contributionKey(preview)),
						) &&
							preview.kind === "skills" && (
								<div className="space-y-2">
									<p className="text-xs text-muted-foreground">
										This global switch matches the skill name, not its package. It affects all copies named {preview.name}, including authored skills. Workspace
										disabledExtensions can still override it.
									</p>
									<ul className="text-xs text-muted-foreground">
										{snapshot.items
											.filter((item) => item.kind === "skills" && item.name === preview.name)
											.map((item) => (
												<li key={contributionKey(item)} className="break-all">
													{item.path}
												</li>
											))}
									</ul>
									<Button
										size="compact"
										variant="outline"
										disabled={busy}
										onClick={() => {
											setConfirmation({
												title: preview.state === "disabled" ? "Enable named skill" : "Disable named skill",
												detail: `Change disabledExtensions for skill:${preview.name} globally. All matching copies above are affected; workspace overrides are preserved.`,
												change: { kind: "skill-enabled", name: preview.name, enabled: preview.state === "disabled" },
											});
											setPreview(null);
										}}
									>
										{preview.state === "disabled" ? "Enable named skill" : "Disable named skill"}
									</Button>
								</div>
							)}
						{previewRead.error ? (
							<p role="alert" className={ERROR_TEXT}>
								{previewRead.error}
							</p>
						) : previewRead.data ? (
							<FileView readOnly file={previewRead.data} />
						) : (
							<p className="text-sm text-muted-foreground">Reading contribution…</p>
						)}
					</div>
				</FormDialog>
			)}
		</div>
	);
}
