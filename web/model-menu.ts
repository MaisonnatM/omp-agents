/** What the model menu derives from the model list and plan usage. */
import type { ExtraUsage, ModelEntry, PlanUsage, PlanWindow } from "../src/shared/models";
import { everyWord } from "../src/shared/every-word";

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

/** The account a provider heading counts, how much of its tightest window is used, and what it spent past its plan. */
export interface ProviderQuota {
	/** 0 to 1, the tightest window of {@link account}; `null` when the account reports only extra usage. */
	used: number | null;
	/** The account omp moves to: the one with the most left. omp's account id, else its plan name. */
	account: string;
	/** That account's windows, the ones the heading's tooltip lists. */
	windows: PlanWindow[];
	extra: ExtraUsage | null;
}

/**
 * How much of `provider`'s quota is used. With several accounts, omp moves to the one with the most left, so that
 * account's tightest window counts, and its windows and extra usage are the ones to show; an account with extra usage
 * but no window counts only when no account has a window. `null` when `omp usage` reports no plan.
 */
export function providerQuota(plans: readonly PlanUsage[], provider: string): ProviderQuota | null {
	let best: { used: number | null; plan: PlanUsage } | null = null;
	for (const plan of plans) {
		if (plan.provider !== provider || (plan.windows.length === 0 && plan.extra === null)) continue;
		const used = plan.windows.length === 0 ? null : Math.max(...plan.windows.map(window => 1 - window.remaining));
		if (!best || (used !== null && (best.used === null || used < best.used))) best = { used, plan };
	}
	return best && { used: best.used, account: best.plan.account ?? best.plan.name, windows: best.plan.windows, extra: best.plan.extra };
}

/** The model search's filter, as cmdk calls it: every word typed is in the model's selector or one of its names, in any order. */
export function modelMatch(value: string, search: string, keywords: readonly string[] = []): number {
	return everyWord(search)([value, ...keywords].join(" ")) ? 1 : 0;
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
