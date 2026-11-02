import { basename, dirname, join, relative } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { errorText, isObject } from "../json";
import { HOME } from "../paths";
import {
	EXTENSION_CONTRIBUTION_KINDS,
	type ExtensionCatalog,
	type ExtensionChange,
	type ExtensionContribution,
	type ExtensionContributionKind,
	type ExtensionContributionTarget,
	type ExtensionPackage,
	type ExtensionsAnswer,
} from "../shared/extensions";
import {
	dirs,
	discovery,
	extensionSettings,
	agentDiscovery,
	marketplaceManager,
	marketplaceRegistry,
	pluginRegistryDiscovery,
	pluginManager,
	pluginEntries,
	skillClient,
	skillInstaller,
	skillManifest,
} from "./modules";
import { configWrites, loadGlobalForWrite, loadSessionSettings, setting } from "./config";
import type { NativePlugin, SkillHooks } from "./module-types/extensions";
import { withDiscovery } from "./scoped-discovery";

function within(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

async function registryFiles(cwd: string | null) {
	const project = cwd === null ? undefined : await pluginRegistryDiscovery.resolveOrDefaultProjectRegistryPath(cwd);
	return {
		marketplacesRegistryPath: marketplaceRegistry.getMarketplacesRegistryPath(),
		installedRegistryPath: marketplaceRegistry.getInstalledPluginsRegistryPath(),
		projectInstalledRegistryPath: project,
	};
}

// pi-coding-agent/src/extensibility/plugins/marketplace/registry.ts catches parse errors and returns an empty registry.
// Refuse malformed data before a native write can replace the existing registry.
export async function assertRegistryReadable(path: string, kind: "marketplaces" | "plugins"): Promise<void> {
	try {
		const value: unknown = await Bun.file(path).json();
		if (
			!isObject(value) ||
			(kind === "marketplaces"
				? value.version !== 1 || !Array.isArray(value.marketplaces)
				: typeof value.version !== "number" || !isObject(value.plugins) || Array.isArray(value.plugins))
		)
			throw new Error("Invalid registry shape");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new Error(`Cannot read ${path}. Repair it before managing packages. ${errorText(err)}`);
	}
}

async function manager(cwd: string | null) {
	const paths = await registryFiles(cwd);
	await Promise.all([
		assertRegistryReadable(paths.marketplacesRegistryPath, "marketplaces"),
		assertRegistryReadable(paths.installedRegistryPath, "plugins"),
		...(paths.projectInstalledRegistryPath ? [assertRegistryReadable(paths.projectInstalledRegistryPath, "plugins")] : []),
	]);
	return new marketplaceManager.MarketplaceManager({
		...paths,
		marketplacesCacheDir: marketplaceRegistry.getMarketplacesCacheDir(),
		pluginsCacheDir: marketplaceRegistry.getPluginsCacheDir(),
		clearPluginRootsCache: pluginRegistryDiscovery.clearClaudePluginRootsCache,
	});
}

async function registrySettings(cwd: string): Promise<ExtensionsAnswer["registry"]> {
	const [effective, user] = await Promise.all([loadSessionSettings(cwd), loadSessionSettings(HOME)]);
	const global = String(setting("skills.registryUrl").get(user));
	const url = String(setting("skills.registryUrl").get(effective));
	return { url, global, overridden: url !== global };
}

export async function workspaceExtensions(
	cwd: string | null,
	kinds: readonly ExtensionContributionKind[] = EXTENSION_CONTRIBUTION_KINDS,
): Promise<Pick<ExtensionsAnswer, "items" | "providers" | "diagnostics">> {
	const dir = cwd ?? HOME;
	return withDiscovery(dir, async (settings) => {
		discovery.reset();
		const disabled = extensionSettings.cfgDisabledExtensions.get(settings);
		const diagnostics: string[] = [];
		const items = (
			await Promise.all(
				kinds
					.filter((kind) => kind !== "agents")
					.map(async (kind) => {
						const options = {
							cwd: dir,
							disabledExtensions: disabled,
							filter: (item: { _source: { level: string } }) => cwd !== null || item._source.level !== "project",
						};
						// Ask omp for both inventory and availability rather than duplicating its filtering rules.
						const [result, selected] = await Promise.all([
							discovery.loadCapability(kind, { ...options, includeDisabled: true }),
							discovery.loadCapability(kind, options),
						]);
						diagnostics.push(...result.warnings);
						const available = new Set(selected.items.map((item) => item._source.path));
						return result.all.map((item): ExtensionContribution => {
							const name = item.name ?? basename(item.path ?? item._source.path);
							return {
								kind,
								name,
								path: item.path ?? item._source.path,
								provider: item._source.provider,
								scope: item._source.level,
								state: item._shadowed ? "shadowed" : available.has(item._source.path) ? "available" : "disabled",
								invocation: kind === "skills" ? `/skill:${name}` : kind === "slash-commands" ? `/${name}` : null,
							};
						});
					}),
			)
		).flat();
		if (kinds.includes("agents")) {
			try {
				const { agents } = await agentDiscovery.discoverAgents(dir);
				for (const agent of agents)
					if (agent.filePath && (cwd !== null || agent.source === "user"))
						items.push({
							kind: "agents",
							name: agent.name ?? basename(agent.filePath),
							path: agent.filePath,
							provider: "task-discovery",
							scope: agent.source === "project" ? "project" : "user",
							state: "available",
							invocation: null,
						});
			} catch (err) {
				diagnostics.push(`Agent discovery: ${errorText(err)}`);
			}
		}
		const providers = discovery
			.getAllProvidersInfo()
			.map((provider) => ({
				id: provider.id,
				name: provider.displayName,
				description: provider.description,
				enabled: provider.enabled,
				foreign: discovery.isForeignUserProvider(provider.id),
				userEnabled: discovery.isUserSourceEnabled(provider.id),
			}));
		return { items, providers, diagnostics };
	});
}

async function contributionsFor(pkg: ExtensionPackage, items: ExtensionContribution[], canonicalPaths: Map<string, string>): Promise<ExtensionContribution[]> {
	const path = pkg.root;
	if (!path) return [];
	const root = await realpath(path).catch(() => path);
	return items.filter((item) => item.scope === pkg.target.scope && within(root, canonicalPaths.get(item.path) ?? item.path));
}

function pluginDeclarations(plugin: NativePlugin): ExtensionContribution[] {
	const kinds = { tools: "tools", hooks: "hooks", commands: "slash-commands", extensions: "extension-modules" } as const;
	return (Object.keys(kinds) as (keyof typeof kinds)[]).flatMap((kind) =>
		pluginEntries
			.resolvePluginManifestEntries(plugin, kind)
			.map((entry) => ({
				kind: kinds[kind],
				name: entry.entry,
				path: entry.resolvedPath ?? join(plugin.path, entry.entry),
				provider: "plugin-manifest",
				scope: "user" as const,
				state: entry.resolvedPath ? ("declared" as const) : ("missing" as const),
				invocation: null,
			})),
	);
}

export async function findExtensionContribution(cwd: string | null, target: ExtensionContributionTarget): Promise<ExtensionContribution | undefined> {
	const items =
		target.provider === "plugin-manifest"
			? (await new pluginManager.PluginManager(cwd ?? HOME).list()).flatMap(pluginDeclarations)
			: (await workspaceExtensions(cwd, [target.kind])).items;
	return items.find((item) => item.kind === target.kind && item.path === target.path && item.provider === target.provider && item.scope === target.scope);
}

export async function loadExtensions(cwd: string | null): Promise<ExtensionsAnswer> {
	const dir = cwd ?? HOME;
	const preview = await workspaceExtensions(cwd);
	const packages: ExtensionPackage[] = [];
	let sources: ExtensionsAnswer["sources"] = [];
	const paths = await registryFiles(cwd);
	try {
		const native = await manager(cwd);
		const [marketplaces, installed, updates] = await Promise.all([native.listMarketplaces(), native.listInstalledPlugins(), native.checkForUpdates()]);
		sources = marketplaces;
		packages.push(
			...(
				await Promise.all(
					installed.map(async (installed) => {
						const entry = installed.entries[0];
						if (!entry) return [];
						const at = installed.id.lastIndexOf("@");
						const update = updates.find((update) => update.pluginId === installed.id && update.scope === installed.scope);
						return [
							{
								target: { kind: "marketplace" as const, id: installed.id, scope: installed.scope },
								name: installed.id.slice(0, at),
								source: installed.id.slice(at + 1),
								version: entry.version,
								range: null,
								root: entry.installPath,
								description: "",
								enabled: entry.enabled !== false,
								shadowedBy: installed.shadowedBy ?? null,
								stored: await stat(entry.installPath).then(
									(info) => info.isDirectory(),
									() => false,
								),
								contributions: [],
								inventory: null,
								availableVersion: update?.to ?? null,
								updateNote: null,
							},
						];
					}),
				)
			).flat(),
		);
	} catch (err) {
		preview.diagnostics.push(errorText(err));
	}
	try {
		const native = new pluginManager.PluginManager(dir);
		packages.push(
			...(await Promise.all(
				(await native.list()).map(async (plugin) => {
					let updateNote: string | null = null;
					try {
						await native.validateUpgrade(plugin.name);
					} catch (err) {
						updateNote = errorText(err);
					}
					return {
						target: { kind: "plugin" as const, id: plugin.name, scope: "user" as const },
						name: plugin.name,
						source: null,
						version: plugin.version,
						range: null,
						root: plugin.path,
						description: plugin.manifest.description ?? "",
						enabled: plugin.enabled,
						shadowedBy: null,
						stored: true,
						contributions: pluginDeclarations(plugin),
						inventory: null,
						availableVersion: null,
						updateNote,
					};
				}),
			)),
		);
	} catch (err) {
		preview.diagnostics.push(`Plugins: ${errorText(err)}`);
	}
	try {
		for (const skill of await skillInstaller.listInstalledSkills(dir)) {
			if (cwd === null && skill.scope === "project") continue;
			const parsed = skillManifest.parseSkillId(skill.id);
			if (!parsed) throw new Error(`Invalid installed skill ID: ${skill.id}`);
			packages.push({
				target: { kind: "registry-skill", id: skill.id, scope: skill.scope },
				name: skill.id,
				source: null,
				version: skill.version ?? null,
				range: skill.range ?? null,
				root: skill.version ? skillManifest.getSkillStorePath(parsed.scope, parsed.name, skill.version) : null,
				description: "",
				enabled: null,
				shadowedBy: null,
				stored: skill.stored,
				contributions: [],
				inventory: null,
				availableVersion: null,
				updateNote: null,
			});
		}
	} catch (err) {
		preview.diagnostics.push(`Registry skills: ${errorText(err)}`);
	}
	const canonicalPaths = new Map(
		await Promise.all([...new Set(preview.items.map((item) => item.path))].map(async (path) => [path, await realpath(path).catch(() => path)] as const)),
	);
	await Promise.all(
		packages.map(async (pkg) => {
			const discovered = await contributionsFor(pkg, preview.items, canonicalPaths);
			const paths = new Set(discovered.map((item) => item.path));
			pkg.contributions = [...discovered, ...pkg.contributions.filter((item) => !paths.has(item.path))];
			if (pkg.contributions.length === 0) pkg.inventory = pkg.enabled === false || pkg.shadowedBy ? "unavailable" : "undiscovered";
		}),
	);
	const skillsTarget = await skillManifest.getSkillsInstallPaths({ global: true, cwd: dir });
	return {
		cwd,
		packages,
		...preview,
		sources,
		registry: await registrySettings(dir),
		projectTarget: paths.projectInstalledRegistryPath ? dirname(dirname(paths.projectInstalledRegistryPath)) : null,
		userTargets: { plugins: dirs.getPluginsDir(), skills: skillsTarget.dir },
	};
}

export async function discoverExtensions(cwd: string | null, source: string, q: string, page: number): Promise<ExtensionCatalog> {
	if (source === "registry") {
		const client = await skillClient.SkillshareClient.create({ registryUrl: (await registrySettings(cwd ?? HOME)).url });
		try {
			const result = await client.search(q, { page });
			return {
				entries: result.hits.map((hit) => ({
					key: `registry:${hit.scope}/${hit.name}`,
					kind: "registry-skill",
					id: `@${hit.scope}/${hit.name}`,
					name: `@${hit.scope}/${hit.name}`,
					source: "registry",
					version: hit.version,
					description: hit.description,
				})),
				page,
				more: result.page * result.perPage < result.total,
				diagnostics: [],
			};
		} finally {
			client.close();
		}
	}
	const native = await manager(cwd);
	const sources = (await native.listMarketplaces()).filter((entry) => !source || entry.name === source);
	const diagnostics: string[] = [];
	const entries = (
		await Promise.all(
			sources.map(async (entry) => {
				try {
					return (await native.listAvailablePlugins(entry.name))
						.filter((plugin) => `${plugin.name} ${plugin.description ?? ""}`.toLowerCase().includes(q.toLowerCase()))
						.map((plugin) => ({
							key: `${entry.name}:${plugin.name}`,
							kind: "marketplace" as const,
							id: plugin.name,
							name: plugin.name,
							source: entry.name,
							version: plugin.version ?? null,
							description: plugin.description ?? "",
						}));
				} catch (err) {
					diagnostics.push(`${entry.name}: ${errorText(err)}`);
					return [];
				}
			}),
		)
	).flat();
	return { entries, page: 1, more: false, diagnostics };
}

async function writeList(cwd: string, id: string, entry: string, include: boolean): Promise<void> {
	await configWrites.run(async () => {
		const settings = await loadGlobalForWrite(cwd);
		const global = settings.getGlobalSettings()[id];
		const values = Array.isArray(global) ? global.filter((value): value is string => typeof value === "string") : [];
		setting(id).set(settings, include ? [...new Set([...values, entry])] : values.filter((value) => value !== entry));
		await settings.flush();
	});
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
			await configWrites.run(async () => {
				const settings = await loadGlobalForWrite(dir);
				setting("skills.registryUrl").set(settings, change.url);
				await settings.flush();
			});
		} else if (change.kind === "skill-enabled") {
			await writeList(dir, "disabledExtensions", `skill:${change.name}`, !change.enabled);
		} else if (change.kind === "provider") {
			const provider = discovery.getAllProvidersInfo().find((provider) => provider.id === change.id);
			if (!provider || (change.userOnly && !discovery.isForeignUserProvider(change.id))) throw new Error("Unknown discovery provider");
			await writeList(dir, change.userOnly ? "enabledProviders" : "disabledProviders", change.id, change.userOnly ? change.enabled : !change.enabled);
		} else {
			const target = change.kind === "install" ? { kind: change.packageKind, scope: change.scope, id: change.spec } : change.target;
			if (target.kind === "marketplace") {
				const native = await manager(cwd);
				if (change.kind === "install") await native.installPlugin(change.spec, change.source, { scope: target.scope });
				else if (change.kind === "update") await native.upgradePlugin(target.id, target.scope);
				else if (change.kind === "uninstall") await native.uninstallPlugin(target.id, target.scope);
				else await native.setPluginEnabled(target.id, change.enabled, target.scope);
			} else if (target.kind === "plugin") {
				const native = new pluginManager.PluginManager(dir);
				if (change.kind === "install") {
					if (change.source === "link") await native.link(change.spec);
					else await native.install(change.spec);
				} else if (change.kind === "update") await native.upgrade(target.id);
				else if (change.kind === "uninstall") await native.uninstall(target.id);
				else await native.setEnabled(target.id, change.enabled);
			} else if (change.kind !== "enabled") {
				const options = { global: target.scope === "user", cwd: dir };
				if (change.kind === "uninstall") await skillInstaller.uninstallSkillPackages({ ...options, names: [target.id] });
				else {
					const client = await skillClient.SkillshareClient.create({ registryUrl: (await registrySettings(dir)).url });
					try {
						if (change.kind === "install") await skillInstaller.installSkillPackages(client, { ...options, specs: [change.spec], yes: false }, hooks);
						else await skillInstaller.updateSkillPackages(client, { ...options, names: [target.id], yes: false }, hooks);
					} finally {
						client.close();
					}
				}
			}
		}
	} finally {
		pluginRegistryDiscovery.clearClaudePluginRootsCache();
		discovery.reset();
	}
}
