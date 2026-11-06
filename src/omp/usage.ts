import { auth } from "./modules";
import type { AuthStorage, UsageReport } from "./module-types/models";

const TIMEOUT_MS = 30_000;
const BILLING_TTL_MS = 5 * 60_000;

/**
 * Keeps the full billing responses between polls. omp stores usage reports without `raw`, so this has to run
 * before `omp usage` and hold the fresh responses itself. It does not clear omp's cache: a failed refresh would
 * drop the last good quotas.
 */
export function createRawUsageReader(
	discover: () => Promise<Pick<AuthStorage, "usage" | "close">>,
	now: () => number = Date.now,
): () => Promise<UsageReport[] | null> {
	let cached: UsageReport[] | null = null;
	let expiresAt = 0;
	let pending: Promise<UsageReport[] | null> | null = null;
	return async () => {
		if (pending) return pending;
		if (cached !== null && now() < expiresAt) return cached;
		pending = (async () => {
			const storage = await discover();
			try {
				const signal = AbortSignal.timeout(TIMEOUT_MS);
				const reports = await storage.usage.reports({ signal });
				if (reports?.some(report => report.raw != null)) {
					cached = reports;
					expiresAt = now() + BILLING_TTL_MS;
				}
				return cached ?? reports;
			} catch {
				return cached;
			} finally {
				storage.close();
			}
		})();
		try {
			return await pending;
		} finally {
			pending = null;
		}
	};
}

/** Reads every provider's billing before the CLI can fill omp's shared cache with a normalized-only response. */
export const readRawUsageReports = createRawUsageReader(() => auth.discoverAuthStorage());
