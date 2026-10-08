/** Newer versions of the Claude and GPT models omp's routing names, and the routing edits that move to them. */
import type { CatalogModel, RoutingEdit } from "../shared/models";
import type { ModelUpdate } from "../shared/notices";
import { type OmpConfig, parseRetryFallbackSelector } from "./config";
import { modelIdentity } from "./modules";

/** A dated snapshot, such as `claude-sonnet-4-5-20250929` or `gpt-5-2025-08-07`, pins its version on purpose. */
const SNAPSHOT = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

type Routing = Pick<OmpConfig, "modelRoles" | "fallbackChains">;

/** A selector of the routing that names a listed model: a role's, or entry `index` of a fallback chain. */
interface Routed {
	slot: { role: string } | { chain: string; index: number };
	provider: string;
	id: string;
	/** What follows `provider/id` in the selector, such as `:high` or `:auto`. */
	suffix: string;
}

/**
 * The product line of a Claude or GPT model and its revision. omp's family alone joins tiers (`gpt` holds `gpt-6-sol`
 * and `gpt-6-luna`), so the line also keeps the id with its first version number masked.
 */
function versionOf(provider: string, id: string): { line: string; revision: string } | undefined {
	if (SNAPSHOT.test(id)) return undefined;
	const identity = modelIdentity.classifyModel(provider, id, { lenient: true });
	if ((identity.class !== "anthropic" && identity.class !== "openai") || identity.revision === undefined) return undefined;
	return { line: `${provider}/${identity.family}/${id.replace(/\d+(?:[.-]\d+)*/, "#")}`, revision: identity.revision };
}

const idOf = (model: CatalogModel): string => model.selector.slice(model.provider.length + 1);

function routedModels(routing: Routing, catalog: CatalogModel[]): Routed[] {
	const known = new Set(catalog.map(model => model.selector));
	const lookup = { find: (provider: string, id: string) => (known.has(`${provider}/${id}`) ? true : undefined) };
	const read = (slot: Routed["slot"], selector: string): Routed[] => {
		const parsed = parseRetryFallbackSelector(selector, lookup);
		return parsed && known.has(`${parsed.provider}/${parsed.id}`)
			? [{ slot, provider: parsed.provider, id: parsed.id, suffix: selector.trim().slice(parsed.provider.length + 1 + parsed.id.length) }]
			: [];
	};
	return [
		...Object.entries(routing.modelRoles).flatMap(([role, selector]) => read({ role }, selector)),
		...Object.entries(routing.fallbackChains).flatMap(([chain, selectors]) => selectors.flatMap((selector, index) => read({ chain, index }, selector))),
	];
}

const useOf = (slot: Routed["slot"]): string => ("role" in slot ? slot.role : `${slot.chain} fallbacks`);

/** Each model of a connected provider the routing names that has a newer version in `catalog`, with where it is named. */
export function findModelUpdates(catalog: CatalogModel[], routing: Routing, connected: ReadonlySet<string>): ModelUpdate[] {
	const newest = new Map<string, { model: CatalogModel; revision: string }>();
	for (const model of catalog) {
		const version = versionOf(model.provider, idOf(model));
		const best = version && newest.get(version.line);
		if (version && (!best || Bun.semver.order(version.revision, best.revision) > 0)) newest.set(version.line, { model, revision: version.revision });
	}
	const names = new Map(catalog.map(model => [model.selector, model.name]));
	const updates = new Map<string, ModelUpdate>();
	for (const { slot, provider, id } of routedModels(routing, catalog)) {
		const version = connected.has(provider) ? versionOf(provider, id) : undefined;
		const best = version && newest.get(version.line);
		if (!version || !best || Bun.semver.order(best.revision, version.revision) <= 0) continue;
		const to = idOf(best.model);
		const key = `${provider}/${id}>${to}`;
		const update = updates.get(key) ?? { provider, from: { id, name: names.get(`${provider}/${id}`) ?? id }, to: { id: to, name: best.model.name }, uses: [] };
		const use = useOf(slot);
		if (!update.uses.includes(use)) update.uses.push(use);
		updates.set(key, update);
	}
	return [...updates.values()];
}

/** The edits that name `to` wherever the routing names `provider/from`, each keeping its `:level`. */
export function upgradeEdits(routing: Routing, catalog: CatalogModel[], provider: string, from: string, to: string): RoutingEdit[] {
	const moved = routedModels(routing, catalog).filter(routed => routed.provider === provider && routed.id === from);
	const selectorOf = ({ suffix }: Routed): string => `${provider}/${to}${suffix}`;
	const edits: RoutingEdit[] = moved.flatMap(routed => ("role" in routed.slot ? [{ kind: "role", role: routed.slot.role, primary: selectorOf(routed) }] : []));
	const chains = new Map<string, string[]>();
	for (const routed of moved) {
		if (!("chain" in routed.slot)) continue;
		const { chain, index } = routed.slot;
		const fallbacks = chains.get(chain) ?? [...routing.fallbackChains[chain]];
		fallbacks[index] = selectorOf(routed);
		chains.set(chain, fallbacks);
	}
	for (const [chain, fallbacks] of chains) {
		edits.push(chain.includes("/") ? { kind: "model-chain", key: chain, fallbacks } : { kind: "role", role: chain, fallbacks });
	}
	return edits;
}
