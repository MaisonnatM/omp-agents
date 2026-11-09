/**
 * The HTTP API the page reads and writes omp's settings, analytics, pull requests, git checkouts, worktrees,
 * the workspaces Settings adds and hides, the machine's load, the terminal panel's shells, the integrations, the model providers omp signs in to, Linear tickets and their files, the Linear issue a todo opens, Google Calendar and the events kept on this computer, your Gmail inbox, prompt images, the text files agent text names through, the Sport page's demo thumbnails, and the dashboard's own build and update.
 * Every read goes through `get` and every write through `write`; each route group takes only the part of {@link RouteEnv} it reads.
 */
import { isObject } from "../json";
import type { GmailAccounts } from "../gmail";
import type { Integrations } from "../integrations";
import { readCollabAutoStart, shareTerminalSessions } from "../omp/config";
import { isTerminalAccess } from "../shared/readiness";
import { answer, fail, type Guards } from "./http";
import { activityRoutes, type ActivityRoutesEnv } from "./activity-routes";
import { calendarRoutes, type CalendarRoutesEnv } from "./calendar-routes";
import { readStarterKitStatus } from "../readiness";
import { storageRoutes, type StorageRoutesEnv } from "./storage-routes";
import { routeKit, type Routes, type SessionRoutesEnv } from "./route-kit";
import { dashboardRoutes, type DashboardRoutesEnv } from "./dashboard-routes";
import { fileRoutes, type FileRoutesEnv } from "./file-routes";
import { gmailRoutes } from "./gmail-routes";
import { integrationRoutes } from "./integration-routes";
import { processRoutes, type ProcessRoutesEnv } from "./process-routes";
import { providerRoutes } from "./provider-routes";
import { pullRequestRoutes, type PullRequestRoutesEnv } from "./pull-request-routes";
import { sessionRoutes } from "./session-routes";
import { sportThumbRoutes, type SportThumbsEnv } from "./sport-thumbs";
import { phoneAccessRoutes, type PhoneAccessRoutesEnv } from "./phone-access-routes";
import { syncRoutes, type SyncRoutesEnv } from "./sync-routes";
import { todoRoutes, type TodoRoutesEnv } from "./todo-routes";

/** Everything the HTTP API reads, by concern. */
export interface RouteEnv {
	guards: Guards;
	sessions: SessionRoutesEnv;
	/** The MCP integrations, Gmail's and Google Calendar's accounts included. */
	integrations: Integrations;
	calendar: CalendarRoutesEnv;
	gmail: GmailAccounts;
	files: FileRoutesEnv;
	todos: TodoRoutesEnv;
	pullRequests: PullRequestRoutesEnv;
	dashboard: DashboardRoutesEnv;
	sync: SyncRoutesEnv;
	/** The page's activity events, for Settings › Activity. */
	activity: ActivityRoutesEnv;
	processes: ProcessRoutesEnv;
	storage: StorageRoutesEnv;
	sportThumbs: SportThumbsEnv;
	phoneAccess: PhoneAccessRoutesEnv;
}

/** Every `/api/*` route, by path and method. */
export function createRoutes(env: RouteEnv): Routes {
	const kit = routeKit(env.guards);
	const routes: Routes = {
		...sessionRoutes(kit, env.sessions),
		"/api/readiness/starter-kit": { GET: kit.get(() => answer(readStarterKitStatus)) },
		"/api/readiness/terminal-sessions": {
			GET: kit.get(() => answer(readCollabAutoStart)),
			PUT: kit.write(
				(body) => (isObject(body) && isTerminalAccess(body.access) ? body.access : fail(400, "Expected { access } of view or control")),
				async (access) => {
					await shareTerminalSessions(access);
					return readCollabAutoStart();
				},
			),
		},
		...integrationRoutes(kit, env.integrations),
		...providerRoutes(kit),
		...calendarRoutes(kit, env.calendar),
		...gmailRoutes(kit, env.gmail),
		...pullRequestRoutes(kit, env.pullRequests),
		...fileRoutes(kit, env.files),
		...todoRoutes(kit, env.todos),
		...dashboardRoutes(kit, env.dashboard),
		...syncRoutes(kit, env.sync),
		...processRoutes(kit, env.processes),
		...storageRoutes(kit, env.storage, env.sessions),
		...sportThumbRoutes(kit, env.sportThumbs),
		...phoneAccessRoutes(env.guards, env.phoneAccess),
	};
	return { ...routes, ...activityRoutes(kit, env.activity, routes) };
}
