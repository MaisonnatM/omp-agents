/** `GET /api/activity`: Settings › Activity's read of the activity store. */
import { foldActivity } from "../activity";
import { windowOf } from "../omp/stats";
import type { ActivityRead } from "../shared/activity";
import { isAnalyticsRange } from "../shared/analytics";
import type { ActivityStore } from "./activity-store";
import { answer, fail } from "./http";
import type { RouteKit, Routes } from "./routes";

/** What the activity read takes of the store. */
export type ActivityRoutesEnv = Pick<ActivityStore, "rows" | "lastUsed">;

/** `GET /api/activity?range=`: the page's activity over the range, defaulting to `30d`, with every other route's `PUT` path for the inventory of actions. */
export function activityRoutes({ get }: RouteKit, store: ActivityRoutesEnv, others: Routes): Routes {
	const serverActions = Object.keys(others).filter(path => others[path]!.PUT);
	return {
		"/api/activity": {
			GET: get(params => {
				const range = params.get("range") ?? "30d";
				if (!isAnalyticsRange(range)) return fail(400, "Unknown activity range");
				return answer(async (): Promise<ActivityRead> => {
					const now = Date.now();
					return { range, ...foldActivity(store.rows(windowOf(range, now).cutoff ?? 0), now), lastUsed: store.lastUsed(), serverActions };
				});
			}),
		},
	};
}
