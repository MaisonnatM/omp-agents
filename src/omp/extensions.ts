import { basename, dirname, join, relative } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { errorText, isObject } from "../json";
import { HOME } from "../paths";
import type { ExtensionCatalog, ExtensionChange, ExtensionContribution, ExtensionPackage, ExtensionsAnswer } from "../shared/extensions";
import { config, dirs, discovery, extensionSettings, agentDiscovery, marketplaceManager, marketplaceRegistry, pluginRegistryDiscovery, pluginManager, pluginEntries, settingsRegistry, skillClient, skillInstaller, skillManifest } from "./modules";
import type { NativePlugin, SkillHooks } from "./module-types/extensions";
import { withDiscovery } from "./scoped-discovery";

const CAPABILITIES = ["skills", "slash-commands", "hooks", "tools", "mcps", "extension-modules", "rules", "prompts"];
const setting = (id: string) => {
	const handle = settingsRegistry.lookup(id);
	if (!handle) throw new Error(`omp has no setting ${id}`);
	return handle;
};
const keyOf = (kind: string, id: string, scope: string) => JSON.stringify([kind, id, scope]);
const within = (root: string, path: string): boolean => { const rel = relative(root, path); return rel === "" || !rel.startsWith("..") && !rel.startsWith("/"); };

async function registryFiles(cwd: string | null) {
	const project = cwd === null ? undefined : await pluginRegistryDiscovery.resolveOrDefaultProjectRegistryPath(cwd);
	return { marketplacesRegistryPath: marketplaceRegistry.getMarketplacesRegistryPath(), installedRegistryPath: marketplaceRegistry.getInstalledPluginsRegistryPath(), projectInstalledRegistryPath: project };
}

// omp's registry reader converts malformed JSON into an empty registry. Refuse it before a native write can overwrite it.
export async function assertRegistryReadable(path: string, kind: "marketplaces" | "plugins"): Promise<void> {
	try {
		const value: unknown = await Bun.file(path).json();
		if (!isObject(value) || (kind === "marketplaces" ? value.version !== 1 || !Array.isArray(value.marketplaces) : typeof value.version !== "number" || !isObject(value.plugins) || Array.isArray(value.plugins))) throw new Error("Invalid registry shape");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new Error(`Cannot read ${path}. Repair it before managing packages. ${errorText(err)}`);
	}
}

async function manager(cwd: string | null) {
	const paths = await registryFiles(cwd);
	await assertRegistryReadable(paths.marketplacesRegistryPath, "marketplaces");
	await assertRegistryReadable(paths.installedRegistryPath, "plugins");
	if (paths.projectInstalledRegistryPath) await assertRegistryReadable(paths.projectInstalledRegistryPath, "plugins");
	return new marketplaceManager.MarketplaceManager({ ...paths, marketplacesCacheDir: marketplaceRegistry.getMarketplacesCacheDir(), pluginsCacheDir: marketplaceRegistry.getPluginsCacheDir(), clearPluginRootsCache: pluginRegistryDiscovery.clearClaudePluginRootsCache });
}
async function registrySettings(cwd: string): Promise<ExtensionsAnswer["registry"]> {
	const effective = await config.Settings.loadReadOnly({ cwd });
	const user = await config.Settings.loadReadOnly({ cwd: HOME });
	const global = String(setting("skills.registryUrl").get(user));
	const url = String(setting("skills.registryUrl").get(effective));
	return { url, global, overridden: url !== global };
}

export async function workspaceExtensions(cwd: string | null): Promise<Pick<ExtensionsAnswer, "items" | "providers" | "diagnostics">> {
	const dir = cwd ?? HOME;
	return withDiscovery(dir, async settings => {
		discovery.reset();
		const disabled = extensionSettings.cfgDisabledExtensions.get(settings);
		const diagnostics: string[] = [];
		const items = (await Promise.all(CAPABILITIES.map(async kind => {
			const result = await discovery.loadCapability(kind, { cwd: dir, includeDisabled: true, disabledExtensions: disabled, filter: item => cwd !== null || item._source.level !== "project" });
			diagnostics.push(...result.warnings);
			const available = new Set((await discovery.loadCapability(kind, { cwd: dir, disabledExtensions: disabled, filter: item => cwd !== null || item._source.level !== "project" })).items.map(item => item._source.path));
			return result.all.map((item): ExtensionContribution => {
				const name = item.name ?? basename(item.path ?? item._source.path);
				return { key: keyOf(kind, item._source.path, item._source.level), kind, name, path: item.path ?? item._source.path, provider: item._source.provider, scope: item._source.level, state: item._shadowed ? "shadowed" : available.has(item._source.path) ? "available" : "disabled", invocation: kind === "skills" ? `/skill:${name}` : kind === "slash-commands" ? `/${name}` : null };
			});
		}))).flat();
		try {
			const { agents } = await agentDiscovery.discoverAgents(dir);
			for (const agent of agents) if (agent.filePath && (cwd !== null || agent.source === "user")) items.push({ key: keyOf("agents", agent.filePath, agent.source), kind: "agents", name: agent.name ?? basename(agent.filePath), path: agent.filePath, provider: "task discovery", scope: agent.source === "project" ? "project" : "user", state: "available", invocation: null });
		} catch (err) { diagnostics.push(`Agent discovery: ${errorText(err)}`); }
		const providers = discovery.getAllProvidersInfo().map(provider => ({ id: provider.id, name: provider.displayName, description: provider.description, enabled: provider.enabled, foreign: discovery.isForeignUserProvider(provider.id), userEnabled: discovery.isUserSourceEnabled(provider.id) }));
		return { items, providers, diagnostics };
	});
}

async function contributionsFor(pkg: ExtensionPackage, items: ExtensionContribution[], canonicalPaths: Map<string, string>): Promise<ExtensionContribution[]> {
	if (!pkg.root) return [];
	const root = await realpath(pkg.root).catch(() => pkg.root!);
	return items.filter(item => item.scope === pkg.scope && within(root, canonicalPaths.get(item.path) ?? item.path));
}

function pluginDeclarations(plugin: NativePlugin): ExtensionContribution[] {
	return (["tools", "hooks", "commands", "extensions"] as const).flatMap(kind => pluginEntries.resolvePluginManifestEntries(plugin, kind).map(entry => ({ key: keyOf(kind, entry.resolvedPath ?? entry.entry, "user"), kind, name: entry.entry, path: entry.resolvedPath ?? join(plugin.path, entry.entry), provider: "plugin manifest", scope: "user" as const, state: entry.resolvedPath ? "declared" as const : "missing" as const, invocation: null })));
}

export async function loadExtensions(cwd: string | null): Promise<ExtensionsAnswer> {
	const dir = cwd ?? HOME;
	const preview = await workspaceExtensions(cwd);
	const packages: ExtensionPackage[] = [];
	let sources: ExtensionsAnswer["sources"] = [];
	const paths = await registryFiles(cwd);
	try {
		const native = await manager(cwd);
		sources = await native.listMarketplaces();
		for (const installed of await native.listInstalledPlugins()) {
			const entry = installed.entries[0];
			if (!entry) continue;
			const at = installed.id.lastIndexOf("@");
			packages.push({ key: keyOf("marketplace", installed.id, installed.scope), kind: "marketplace", id: installed.id, name: installed.id.slice(0, at), source: installed.id.slice(at + 1), scope: installed.scope, version: entry.version, range: null, root: entry.installPath, description: "", enabled: entry.enabled !== false, shadowedBy: installed.shadowedBy ?? null, stored: await stat(entry.installPath).then(info => info.isDirectory(), () => false), contributions: [], inventoryNote: null, availableVersion: null, updateNote: null });
		}
		for (const update of await native.checkForUpdates()) {
			const pkg = packages.find(pkg => pkg.kind === "marketplace" && pkg.id === update.pluginId && pkg.scope === update.scope);
			if (pkg) pkg.availableVersion = update.to;
		}
	} catch (err) { preview.diagnostics.push(errorText(err)); }
	try {
		const native = new pluginManager.PluginManager(dir);
		for (const plugin of await native.list()) {
			let updateNote: string | null = null;
			try { await native.validateUpgrade(plugin.name); } catch (err) { updateNote = errorText(err); }
			packages.push({ key: keyOf("plugin", plugin.name, "user"), kind: "plugin", id: plugin.name, name: plugin.name, source: "npm, git, or linked package", scope: "user", version: plugin.version, range: null, root: plugin.path, description: plugin.manifest.description ?? "", enabled: plugin.enabled, shadowedBy: null, stored: true, contributions: pluginDeclarations(plugin), inventoryNote: null, availableVersion: null, updateNote });
		}
	} catch (err) { preview.diagnostics.push(`Plugins: ${errorText(err)}`); }
	try {
		for (const skill of await skillInstaller.listInstalledSkills(dir)) {
			if (cwd === null && skill.scope === "project") continue;
			const parsed = skillManifest.parseSkillId(skill.id)!;
			packages.push({ key: keyOf("registry-skill", skill.id, skill.scope), kind: "registry-skill", id: skill.id, name: skill.id, source: "Skill registry", scope: skill.scope, version: skill.version ?? null, range: skill.range ?? null, root: skill.version ? skillManifest.getSkillStorePath(parsed.scope, parsed.name, skill.version) : null, description: "", enabled: null, shadowedBy: null, stored: skill.stored, contributions: [], inventoryNote: null, availableVersion: null, updateNote: null });
		}
	} catch (err) { preview.diagnostics.push(`Registry skills: ${errorText(err)}`); }
	const canonicalPaths = new Map(await Promise.all([...new Set(preview.items.map(item => item.path))].map(async path => [path, await realpath(path).catch(() => path)] as const)));
	for (const pkg of packages) {
		const discovered = await contributionsFor(pkg, preview.items, canonicalPaths);
		const paths = new Set(discovered.map(item => item.path));
		pkg.contributions = [...discovered, ...pkg.contributions.filter(item => !paths.has(item.path))];
		if (pkg.contributions.length === 0) pkg.inventoryNote = pkg.enabled === false || pkg.shadowedBy ? "omp does not expose a static inventory for disabled or overridden package roots." : "No contributions discovered. Check the inventory warnings before treating this as empty.";
	}
	const skillsTarget = await skillManifest.getSkillsInstallPaths({ global: true, cwd: dir });
	return { cwd, packages, ...preview, sources, registry: await registrySettings(dir), projectTarget: paths.projectInstalledRegistryPath ? dirname(dirname(paths.projectInstalledRegistryPath)) : null, userTargets: { plugin: dirs.getPluginsDir(), marketplace: dirs.getPluginsDir(), "registry-skill": skillsTarget.dir } };
}

export async function discoverExtensions(cwd: string | null, source: string, q: string, page: number): Promise<ExtensionCatalog> {
	if (source === "registry") {
		const client = await skillClient.SkillshareClient.create({ registryUrl: (await registrySettings(cwd ?? HOME)).url });
		try {
			const result = await client.search(q, { page });
			return { entries: result.hits.map(hit => ({ key: `registry:${hit.scope}/${hit.name}`, kind: "registry-skill", id: `@${hit.scope}/${hit.name}`, name: `@${hit.scope}/${hit.name}`, source: "registry", version: hit.version, description: hit.description })), page, more: result.page * result.perPage < result.total, diagnostics: [] };
		} finally { client.close(); }
	}
	const native = await manager(cwd);
	const sources = (await native.listMarketplaces()).filter(entry => !source || entry.name === source);
	const entries: ExtensionCatalog["entries"] = [];
	const diagnostics: string[] = [];
	for (const entry of sources) {
		try { for (const plugin of await native.listAvailablePlugins(entry.name)) if (`${plugin.name} ${plugin.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) entries.push({ key: `${entry.name}:${plugin.name}`, kind: "marketplace", id: plugin.name, name: plugin.name, source: entry.name, version: plugin.version ?? null, description: plugin.description ?? "" }); }
		catch (err) { diagnostics.push(`${entry.name}: ${errorText(err)}`); }
	}
	return { entries, page: 1, more: false, diagnostics };
}

async function writeList(cwd: string, id: string, entry: string, include: boolean): Promise<void> {
	await config.Settings.loadReadOnly({ cwd });
	const settings = await config.Settings.loadIsolated({ cwd });
	const global = settings.getGlobalSettings()[id];
	const values = Array.isArray(global) ? global.filter((value): value is string => typeof value === "string") : [];
	setting(id).set(settings, include ? [...new Set([...values, entry])] : values.filter(value => value !== entry));
	await settings.flush();
}

export async function changeExtensions(cwd: string | null, change: ExtensionChange, hooks: SkillHooks): Promise<void> {
	const dir = cwd ?? HOME;
	try {
	if (change.kind === "source-add" || change.kind === "source-remove" || change.kind === "source-refresh") {
		const native = await manager(cwd);
		if (change.kind === "source-add") await native.addMarketplace(change.source);
		else if (change.kind === "source-remove") await native.removeMarketplace(change.name);
		else await native.updateMarketplace(change.name);
	} else if (change.kind === "registry") {
		await config.Settings.loadReadOnly({ cwd: dir });
		const settings = await config.Settings.loadIsolated({ cwd: dir });
		setting("skills.registryUrl").set(settings, change.url);
		await settings.flush();
	} else if (change.kind === "skill-enabled") {
		const snapshot = await loadExtensions(cwd);
		if (!snapshot.packages.some(pkg => pkg.kind === "registry-skill" && pkg.contributions.some(item => item.name === change.name))) throw new Error("This registry skill is no longer discovered. Refresh the package list.");
		await writeList(dir, "disabledExtensions", `skill:${change.name}`, !change.enabled);
	} else if (change.kind === "provider") {
		const preview = await workspaceExtensions(cwd);
		const provider = preview.providers.find(provider => provider.id === change.id);
		if (!provider || change.userOnly && !provider.foreign) throw new Error("Unknown discovery provider");
		await writeList(dir, change.userOnly ? "enabledProviders" : "disabledProviders", change.id, change.userOnly ? change.enabled : !change.enabled);
	} else {
		const pkg = change.kind === "install" ? null : (await loadExtensions(cwd)).packages.find(pkg => pkg.key === change.key);
		if (change.kind !== "install" && !pkg) throw new Error("This package is no longer installed. Refresh the list.");
		const kind = change.kind === "install" ? change.packageKind : pkg!.kind;
		const scope = change.kind === "install" ? change.scope : pkg!.scope;
		if (scope === "project" && cwd === null) throw new Error("Pick a workspace before installing for it.");
		if (kind === "marketplace") {
			const native = await manager(cwd);
			if (change.kind === "install") await native.installPlugin(change.spec, change.source, { scope });
			else if (change.kind === "update") await native.upgradePlugin(pkg!.id, scope);
			else if (change.kind === "uninstall") await native.uninstallPlugin(pkg!.id, scope);
			else if (change.kind === "enabled") await native.setPluginEnabled(pkg!.id, change.enabled, scope);
		} else if (kind === "plugin") {
			const native = new pluginManager.PluginManager(dir);
			if (scope !== "user") throw new Error("npm, git, and linked plugins install for all workspaces.");
			if (change.kind === "install") {
				if (change.source === "link") await native.link(change.spec);
				else await native.install(change.spec);
			}
			else if (change.kind === "update") await native.upgrade(pkg!.id);
			else if (change.kind === "uninstall") await native.uninstall(pkg!.id);
			else if (change.kind === "enabled") await native.setEnabled(pkg!.id, change.enabled);
		} else {
			if (change.kind === "enabled") throw new Error("Registry packages have no package switch. Enable or disable a named skill instead.");
			const options = { global: scope === "user", cwd: dir };
			if (change.kind === "uninstall") await skillInstaller.uninstallSkillPackages({ ...options, names: [pkg!.id] });
			else {
				const client = await skillClient.SkillshareClient.create({ registryUrl: (await registrySettings(dir)).url });
				try {
					if (change.kind === "install") await skillInstaller.installSkillPackages(client, { ...options, specs: [change.spec], yes: false }, hooks);
					else await skillInstaller.updateSkillPackages(client, { ...options, names: [pkg!.id], yes: false }, hooks);
				} finally { client.close(); }
			}
		}
	}
	} finally {
		pluginRegistryDiscovery.clearClaudePluginRootsCache();
		discovery.reset();
	}
}
