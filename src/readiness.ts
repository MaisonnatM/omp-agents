/** The starter kit's state, which Get started cannot obtain from its existing stores. */
import { planStarterKit, STARTER_KIT_MARKETPLACE } from "../templates/omp/install";
import { agentDir } from "./omp/config";
import { dirs, marketplaceRegistry, pluginRegistryDiscovery, settingsRegistry } from "./omp/modules";
import { ompTemplateDir } from "./server/resources";
import type { StarterKitStatus } from "./shared/readiness";

export async function readStarterKitStatus(): Promise<StarterKitStatus> {
	const [marketplaces, userPlugins, projectPlugins] = await Promise.all([
		marketplaceRegistry.readMarketplacesRegistry(marketplaceRegistry.getMarketplacesRegistryPath()),
		marketplaceRegistry.readInstalledPluginsRegistry(marketplaceRegistry.getInstalledPluginsRegistryPath()),
		pluginRegistryDiscovery.resolveOrDefaultProjectRegistryPath(dirs.getProjectDir()).then(path => path ? marketplaceRegistry.readInstalledPluginsRegistry(path) : null),
	]);
	const plugins = new Set(Object.keys(userPlugins.plugins));
	if (projectPlugins) for (const id of Object.keys(projectPlugins.plugins)) plugins.add(id);
	const plan = planStarterKit(ompTemplateDir, agentDir, {
		knownSettings: new Set(settingsRegistry.all().map(setting => setting.id)),
		hasMarketplace: marketplaces.marketplaces.some(marketplace => marketplace.name === STARTER_KIT_MARKETPLACE.name),
		plugins,
	});
	const actions = [...plan.files, ...plan.settings, plan.marketplace, ...plan.plugins].map(step => step.action);
	return {
		pending: actions.filter(action => action === "create" || action === "update").length,
		kept: actions.filter(action => action === "keep").length,
		total: actions.length,
	};
}
