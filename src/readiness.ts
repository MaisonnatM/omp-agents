/** The starter kit's state, which Get started cannot obtain from its existing stores. */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { planStarterKit, STARTER_KIT_MARKETPLACE } from "../templates/omp/install";
import { agentDir } from "./omp/config";
import { dirs, marketplaceRegistry, pluginRegistryDiscovery, settingsRegistry } from "./omp/modules";
import { ompTemplateDir } from "./server/resources";
import type { StarterKitStatus } from "./shared/readiness";

const PSTACK = "pstack@cursor-plugins";

/** The pstack skills the kit's extension linked beside omp's plugin registry, counting only links whose skill still exists. */
export function linkedPstackSkills(registryPath: string): number {
	const dir = join(dirname(registryPath), "pstack-skills");
	if (!existsSync(dir)) return 0;
	return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isSymbolicLink() && existsSync(join(dir, entry.name, "SKILL.md"))).length;
}

export async function readStarterKitStatus(): Promise<StarterKitStatus> {
	const registryPath = marketplaceRegistry.getInstalledPluginsRegistryPath();
	const [marketplaces, userPlugins, projectPlugins] = await Promise.all([
		marketplaceRegistry.readMarketplacesRegistry(marketplaceRegistry.getMarketplacesRegistryPath()),
		marketplaceRegistry.readInstalledPluginsRegistry(registryPath),
		pluginRegistryDiscovery.resolveOrDefaultProjectRegistryPath(dirs.getProjectDir()).then(path => path ? marketplaceRegistry.readInstalledPluginsRegistry(path) : null),
	]);
	const plugins = new Set(Object.keys(userPlugins.plugins));
	if (projectPlugins) for (const id of Object.keys(projectPlugins.plugins)) plugins.add(id);
	const plan = planStarterKit(ompTemplateDir, agentDir, {
		knownSettings: new Set(settingsRegistry.all().map(setting => setting.id)),
		hasMarketplace: marketplaces.marketplaces.some(marketplace => marketplace.name === STARTER_KIT_MARKETPLACE.name),
		plugins,
	});
	const actions = [...plan.files, ...plan.obsolete, ...plan.settings, plan.marketplace, ...plan.plugins, ...plan.mcpServers].map(step => step.action);
	return {
		pending: actions.filter(action => action === "create" || action === "update" || action === "remove").length,
		kept: actions.filter(action => action === "keep").length,
		total: actions.length,
		pstack: { installed: plugins.has(PSTACK), skills: linkedPstackSkills(registryPath) },
	};
}
