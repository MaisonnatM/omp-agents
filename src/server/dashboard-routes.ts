import { answer, fail } from "./http";
import type { DashboardChangelog, DashboardUpdateOutcome, DashboardUpdateStatus } from "../shared/dashboard-update";
import type { ServedBuild } from "../served-build";
import { UpdateRefused } from "./self-update";
import type { RouteKit, Routes } from "./route-kit";

/** What the dashboard routes read: what the server serves, where it stands, and **Update dashboard** itself. */
export interface DashboardRoutesEnv {
	build: ServedBuild;
	status(): Promise<DashboardUpdateStatus>;
	update(): Promise<DashboardUpdateOutcome>;
	changelog(): Promise<DashboardChangelog>;
}

/**
 * `GET /api/dashboard/build` answers the `ServedBuild`: the checkout the server read at startup and the page it built from it.
 * **Update dashboard**: `GET /api/dashboard/update` answers `DashboardUpdateStatus` without asking origin; `PUT` with any
 * JSON body fast-forwards the server's checkout, installs when `bun.lock` changed, and answers `DashboardUpdateOutcome`
 * before the server restarts, or 409 with why the checkout stays as it was.
 */
export function dashboardRoutes({ get, write }: RouteKit, env: DashboardRoutesEnv): Routes {
	return {
		"/api/dashboard/build": { GET: get(() => Response.json(env.build)) },
		"/api/dashboard/update": {
			GET: get(() => answer(() => env.status())),
			PUT: write(
				() => null,
				() => env.update(),
				(err) => (err instanceof UpdateRefused ? fail(409, err.message) : null),
			),
		},
		/** The header's What's new: `DashboardChangelog`, the checkout's `CHANGELOG.md` read without asking origin. */
		"/api/dashboard/changelog": { GET: get(() => answer(() => env.changelog())) },
	};
}
