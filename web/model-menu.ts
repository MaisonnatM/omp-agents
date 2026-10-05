/** What the model menu derives from the model list and plan usage. */
import type { ModelEntry, PlanUsage, PlanWindow } from "../src/shared";

/** A trailing context size in a model id, as Cursor's `claude-opus-5-5-1m` names its 1M-token variant. */
const CONTEXT_SUFFIX = /-\d+[km]$/i;

/**
 * The models that differ from `selector` only by the context size its id ends in, itself included, smallest window
 * first. Empty when `selector` has no such sibling, so there is no context to choose.
 */
export function contextVariants(models: readonly ModelEntry[], selector: string | null): ModelEntry[] {
	const current = models.find(model => `${model.provider}/${model.id}` === selector);
	if (!current) return [];
	const base = current.id.replace(CONTEXT_SUFFIX, "");
	const variants = models
		.filter(model => model.provider === current.provider && model.contextWindow !== null && model.id.replace(CONTEXT_SUFFIX, "") === base)
		.toSorted((a, b) => (a.contextWindow ?? 0) - (b.contextWindow ?? 0));
	return new Set(variants.map(model => model.contextWindow)).size > 1 ? variants : [];
}

/** The account a provider heading counts, and how much of its tightest window is used. */
export interface ProviderQuota {
	/** 0 to 1, the tightest window of {@link account}. */
	used: number;
	/** The account omp moves to: the one with the most left. omp's account id, else its plan name. */
	account: string;
	/** That account's windows, the ones the heading's tooltip lists. */
	windows: PlanWindow[];
}

/**
 * How much of `provider`'s quota is used. With several accounts, omp moves to the one with the most left, so that
 * account's tightest window counts, and its windows are the ones to show. `null` when `omp usage` reports no plan.
 */
export function providerQuota(plans: readonly PlanUsage[], provider: string): ProviderQuota | null {
	let best: { used: number; plan: PlanUsage } | null = null;
	for (const plan of plans) {
		if (plan.provider !== provider || plan.windows.length === 0) continue;
		const used = Math.max(...plan.windows.map(window => 1 - window.remaining));
		if (!best || used < best.used) best = { used, plan };
	}
	return best && { used: best.used, account: best.plan.account ?? best.plan.name, windows: best.plan.windows };
}

/** The model search's filter, as cmdk calls it: every word typed is in the model's selector or one of its names, in any order. */
export function modelMatch(value: string, search: string, keywords: readonly string[] = []): number {
	const text = [value, ...keywords].join(" ").toLowerCase();
	return search.toLowerCase().split(/\s+/).every(word => text.includes(word)) ? 1 : 0;
}

const LEVEL_LABELS: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

/** omp's thinking level as the menu names it: `xhigh` reads `Extra high`. */
export const levelLabel = (level: string): string => LEVEL_LABELS[level] ?? level;
