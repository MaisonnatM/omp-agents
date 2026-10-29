/** The local setup facts the Get started page cannot obtain from its existing session and integration stores. */
import { planStarterKit, STARTER_KIT_MARKETPLACE } from "../templates/omp/install";
import { errorText } from "./json";
import { agentDir, readCollabAutoStart } from "./omp/config";
import { dirs, marketplaceRegistry, pluginRegistryDiscovery, settingsRegistry } from "./omp/modules";
import { connectedProviders } from "./omp/models";
import { ompTemplateDir } from "./server/resources";
import type { Readiness, ReadinessFact, StarterKitStatus } from "./shared/readiness";

async function observed<T>(read: () => Promise<T>): Promise<ReadinessFact<T>> {
	try {
		return { kind: "known", value: await read() };
	} catch (err) {
		return { kind: "unavailable", message: errorText(err) };
	}
}

export async function readReadiness(): Promise<Readiness> {
	const [providers, collabAutoStart] = await Promise.all([
		observed(async () => (await connectedProviders()).size),
		observed(readCollabAutoStart),
	]);
	return { providers, collabAutoStart };
}

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
	const actions = [...plan.files, ...plan.settings, ...plan.plugins].map(step => step.action);
	actions.push(plan.hasMarketplace ? "same" : "create");
	return {
		pending: actions.filter(action => action === "create" || action === "update").length,
		kept: actions.filter(action => action === "keep").length,
		total: actions.length,
	};
}
