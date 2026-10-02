/** Plan quota left per provider, read from `omp usage --json` of this same omp package. */
import { isObject, num, str } from "./json";
import { ompCommand } from "./omp/install";
import { run } from "./proc";
import type { PlanUsage, PlanWindow } from "./shared";

const TIMEOUT_MS = 30_000;

const PROVIDER_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	"openai-codex": "OpenAI Codex",
	cursor: "Cursor",
};

/** Some providers report only the used fraction, some only absolute amounts. */
function remainingOf(amount: Record<string, unknown>): number | undefined {
	const remaining = num(amount.remainingFraction);
	if (remaining !== undefined) return remaining;
	const left = num(amount.remaining);
	const limit = num(amount.limit);
	if (left !== undefined && limit) return left / limit;
	const used = num(amount.usedFraction);
	return used === undefined ? undefined : 1 - used;
}

function parseLimit(raw: unknown): PlanWindow | null {
	if (!isObject(raw) || !isObject(raw.window) || !isObject(raw.amount)) return null;
	const remaining = remainingOf(raw.amount);
	const window = str(raw.window.id) || str(raw.window.label);
	if (remaining === undefined || !window) return null;
	const tier = isObject(raw.scope) ? str(raw.scope.tier) : undefined;
	return {
		label: tier ? `${window} ${tier}` : window,
		title: str(raw.label) || window,
		remaining: Math.min(1, Math.max(0, remaining)),
		resetsAt: num(raw.window.resetsAt) ?? null,
	};
}

/**
 * Plans with at least one quota window, in omp's order. A window is named by its id (`5h`, `7d`),
 * plus its model tier when it meters one model. Limits that would share a name keep omp's label.
 */
export function parsePlanUsage(stdout: string): PlanUsage[] {
	const data: unknown = JSON.parse(stdout);
	if (!isObject(data) || !Array.isArray(data.reports)) throw new Error("omp usage --json printed no reports");
	const plans: PlanUsage[] = [];
	for (const report of data.reports as unknown[]) {
		if (!isObject(report) || !Array.isArray(report.limits)) continue;
		const provider = str(report.provider);
		const windows = (report.limits as unknown[]).map(parseLimit).filter(window => window !== null);
		if (!provider || windows.length === 0) continue;
		const metadata = isObject(report.metadata) ? report.metadata : {};
		plans.push({
			provider,
			name:
				PROVIDER_NAMES[provider] ??
				provider
					.split(/[-_]/)
					.map(part => part.charAt(0).toUpperCase() + part.slice(1))
					.join(" "),
			account: str(metadata.email) || str(metadata.accountId) || null,
			windows: windows.map(window =>
				windows.some(other => other !== window && other.label === window.label) ? { ...window, label: window.title } : window,
			),
		});
	}
	return plans;
}

/** omp exits non-zero when some provider fails, after printing the reports it did get. */
export async function fetchPlanUsage(): Promise<PlanUsage[]> {
	const { stdout, stderr, code } = await run([...ompCommand, "usage", "--json"], { timeoutMs: TIMEOUT_MS });
	try {
		return parsePlanUsage(stdout);
	} catch {
		throw new Error(stderr.trim().split("\n").pop() || `omp usage exited with code ${code}`);
	}
}
