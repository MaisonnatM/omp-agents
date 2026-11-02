import type { ExtensionScope } from "../../shared/extensions";
export interface NativeMarketplaceSource { name: string; sourceUri: string; updatedAt: string }
export interface NativeCatalogPlugin { name: string; version?: string; description?: string }
export interface NativeInstalledPlugin { id: string; scope: ExtensionScope; shadowedBy?: "project"; entries: { installPath: string; version: string; enabled?: boolean }[] }
export interface MarketplaceOptions { marketplacesRegistryPath: string; installedRegistryPath: string; projectInstalledRegistryPath?: string; marketplacesCacheDir: string; pluginsCacheDir: string; clearPluginRootsCache?: () => void }
export interface NativeMarketplaceManager {
	listMarketplaces(): Promise<NativeMarketplaceSource[]>;
	listAvailablePlugins(source: string): Promise<NativeCatalogPlugin[]>;
	listInstalledPlugins(): Promise<NativeInstalledPlugin[]>;
	addMarketplace(source: string): Promise<unknown>;
	removeMarketplace(name: string): Promise<void>;
	updateMarketplace(name: string): Promise<unknown>;
	checkForUpdates(): Promise<{ pluginId: string; scope: ExtensionScope; from: string; to: string }[]>;
	installPlugin(name: string, source: string, options: { scope: ExtensionScope }): Promise<unknown>;
	uninstallPlugin(id: string, scope: ExtensionScope): Promise<void>;
	setPluginEnabled(id: string, enabled: boolean, scope: ExtensionScope): Promise<void>;
	upgradePlugin(id: string, scope: ExtensionScope): Promise<unknown>;
}
export interface MarketplaceModule { MarketplaceManager: new (options: MarketplaceOptions) => NativeMarketplaceManager }
export interface NativePlugin {
	name: string; version: string; path: string; enabled: boolean; enabledFeatures: string[] | null;
	manifest: { version: string; description?: string };
}
export interface NativePluginManager {
	list(): Promise<NativePlugin[]>;
	install(spec: string): Promise<unknown>;
	link(localPath: string): Promise<unknown>;
	uninstall(name: string): Promise<void>;
	upgrade(name: string): Promise<unknown>;
	validateUpgrade(name: string): Promise<void>;
	setEnabled(name: string, enabled: boolean): Promise<void>;
}
export interface PluginManagerModule { PluginManager: new (cwd: string) => NativePluginManager }
export interface PluginEntriesModule { resolvePluginManifestEntries(plugin: NativePlugin, kind: "tools" | "hooks" | "commands" | "extensions"): { entry: string; resolvedPath: string | null }[] }
export interface NativeSkill { id: string; range?: string; version?: string; scope: ExtensionScope; stored: boolean }
export interface ScriptRequest { id: string; version: string; files: { path: string; executable: boolean }[] }
export interface SkillHooks { confirmScripts(request: ScriptRequest): Promise<boolean>; warn(message: string): void }
export interface NativeSkillClient {
	search(q: string, options: { page: number }): Promise<{ hits: { scope: string; name: string; version: string; description: string }[]; total: number; page: number; perPage: number }>;
	close(): void;
}
export interface SkillClientModule { SkillshareClient: { create(options: { registryUrl: string }): Promise<NativeSkillClient> } }
export interface SkillInstallerModule {
	listInstalledSkills(cwd: string): Promise<NativeSkill[]>;
	installSkillPackages(client: NativeSkillClient, options: { specs: string[]; global: boolean; cwd: string; yes: false }, hooks: SkillHooks): Promise<unknown>;
	updateSkillPackages(client: NativeSkillClient, options: { names: string[]; global: boolean; cwd: string; yes: false }, hooks: SkillHooks): Promise<unknown>;
	uninstallSkillPackages(options: { names: string[]; global: boolean; cwd: string }): Promise<unknown>;
}
export interface SkillManifestModule {
	parseSkillId(id: string): { scope: string; name: string } | null;
	getSkillStorePath(scope: string, name: string, version: string): string;
	getSkillsInstallPaths(options: { global: boolean; cwd: string }): Promise<{ dir: string; manifest: string; lock: string }>;
}
