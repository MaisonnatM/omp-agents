/** The command palette's **Update dashboard**. */
import type { DashboardUpdateOutcome } from "../src/shared/dashboard-update";
import { errorText } from "../src/json";
import { putJson } from "./api";
import { toasts } from "./components/toaster";

export const DASHBOARD_UPDATE_URL = "/api/dashboard/update";

/** Pulls omp-agents and restarts it; a toast says what happened, or why the checkout stayed as it was. */
export async function updateDashboard(): Promise<void> {
	try {
		const outcome = await putJson<DashboardUpdateOutcome>(DASHBOARD_UPDATE_URL, {});
		toasts.add(
			outcome.kind === "current"
				? { title: "omp-agents already runs the newest commit" }
				: { title: `Restarting omp-agents at ${outcome.to.slice(0, 7)}`, description: `${outcome.installed ? "Installed the packages the new bun.lock names. " : ""}The page reloads once the server is back.` },
		);
	} catch (err) {
		toasts.add({ title: "omp-agents did not update", description: errorText(err) });
	}
}
