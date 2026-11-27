/**
 * The order omp tries a provider's sign-ins in. omp's `auth.accountPolicies` ranks them by `priority`, after its quota
 * and safety checks, and Settings › Providers rewrites those priorities for the order the user picks.
 */
import { homedir } from "node:os";
import { isObject } from "../json";
import { userValue, writeAgentSetting } from "./agent-settings";
import { configWrites, loadGlobalForWrite, loadSessionSettings, setting } from "./config";
import type { AccountPolicy, AccountSelector } from "./module-types/models";
import { accountPolicy } from "./modules";

const POLICIES = "auth.accountPolicies";

/** A sign-in Settings can order: its identity, and the selector that names it and no other sign-in of its provider. */
export interface OrderableIdentity {
	identity: AccountSelector;
	selector: AccountSelector;
}

/** The selectors `uniqueSelector` tries, fewest fields first; the last takes every field the sign-in has. */
const SELECTOR_FIELDS: (keyof AccountSelector)[][] = [["email"], ["email", "orgId"], ["accountId"], ["accountId", "orgId"], ["projectId"], ["projectId", "orgId"], ["email", "accountId", "projectId", "orgId"]];

/**
 * The fewest of `identity`'s fields that match it and none of `others`, such as its email, or its email and organization
 * when another sign-in shares the email; `null` when every selector of it matches another too.
 */
export function uniqueSelector(identity: AccountSelector, others: readonly AccountSelector[]): AccountSelector | null {
	for (const [index, fields] of SELECTOR_FIELDS.entries()) {
		if (index < SELECTOR_FIELDS.length - 1 && fields.some(field => !identity[field])) continue;
		const selector: AccountSelector = Object.fromEntries(fields.flatMap(field => (identity[field] ? [[field, identity[field]]] : [])));
		if (!selector.email && !selector.accountId && !selector.projectId) continue;
		if (!others.some(other => accountPolicy.matchesAuthAccountSelector(selector, other))) return selector;
	}
	return null;
}

const isPolicy = (entry: unknown): entry is AccountPolicy => isObject(entry) && typeof entry.provider === "string" && isObject(entry.account);

/** Where in `policies` the one omp applies to `identity` of `provider` sits, as omp picks it: the first whose selector matches; -1 with none. */
const policyAt = (policies: readonly unknown[], provider: string, identity: AccountSelector): number =>
	policies.findIndex(entry => isPolicy(entry) && entry.provider === provider && accountPolicy.matchesAuthAccountSelector(entry.account, identity));

/**
 * `accounts` of `provider` in the order omp tries them: the highest policy `priority` first, an account no policy names
 * (or an API key, whose identity is `null`) at 0, and ties in stored order.
 */
export function rankAccounts<T>(accounts: readonly T[], provider: string, policies: readonly unknown[], identityOf: (account: T) => AccountSelector | null): T[] {
	const priorityOf = (account: T): number => {
		const identity = identityOf(account);
		const policy = identity === null ? undefined : policies[policyAt(policies, provider, identity)];
		return isPolicy(policy) && typeof policy.priority === "number" ? policy.priority : 0;
	};
	return accounts
		.map(account => ({ account, priority: priorityOf(account) }))
		.toSorted((a, b) => b.priority - a.priority)
		.map(({ account }) => account);
}

/**
 * `policies` with `ordered`, `provider`'s sign-ins the first tried first, given descending priorities from
 * `ordered.length` down to 1, so each ranks above the accounts no policy names. A sign-in's own policy keeps its selector
 * and every other field; a sign-in with none gains `{ provider, account: selector, priority }` at the end. Every
 * other entry stays as and where it is.
 */
export function orderPolicies(policies: readonly unknown[], provider: string, ordered: readonly OrderableIdentity[]): unknown[] {
	const next = [...policies];
	ordered.forEach(({ identity, selector }, index) => {
		const priority = ordered.length - index;
		const at = policyAt(next, provider, identity);
		if (at === -1) next.push({ provider, account: selector, priority });
		else next[at] = { ...(next[at] as AccountPolicy), priority };
	});
	return next;
}

/** The user's `auth.accountPolicies`, from the global `config.yml`, which Settings writes. */
export async function readAccountPolicies(): Promise<readonly unknown[]> {
	const value = userValue(setting(POLICIES), await loadSessionSettings(homedir()));
	return Array.isArray(value) ? value : [];
}

/** Writes `ordered`, `provider`'s sign-ins the first tried first, into the user's `auth.accountPolicies` through omp's locked config writer. */
export function writeAccountOrder(provider: string, ordered: readonly OrderableIdentity[]): Promise<void> {
	return configWrites.run(async () => {
		const handle = setting(POLICIES);
		const settings = await loadGlobalForWrite(homedir());
		const expected = userValue(handle, settings);
		const value = orderPolicies(Array.isArray(expected) ? expected : [], provider, ordered);
		handle.assertWritable(value);
		await writeAgentSetting(settings, handle, { id: POLICIES, value, expected });
	});
}
