import { answer, checked } from "./http";
import { parseSyncRepoName, parseSyncRun } from "./wire";
import { parseSyncSettings, type SyncAnswer, type SyncSettings, type SyncSide } from "../shared/settings-sync";
import type { RouteKit, Routes } from "./route-kit";

/** What the settings sync routes read and run: Settings › Sync. */
export interface SyncRoutesEnv {
	answer(): SyncAnswer;
	configure(settings: SyncSettings): SyncAnswer;
	sync(choices: Record<string, SyncSide>): Promise<SyncAnswer>;
	/** Points sync at a private GitHub repository, `name` or `owner/name`, created through `gh` when it does not exist. */
	createRemote(name: string): Promise<SyncAnswer>;
}

/** Settings › Sync: its settings, and a sync, which answers with its outcome whether it synced, conflicted, or failed. */
export function syncRoutes({ get, write }: RouteKit, env: SyncRoutesEnv): Routes {
	return {
		"/api/sync": {
			GET: get(() => answer(async () => env.answer())),
			PUT: write(
				(body) => checked(parseSyncSettings(body)),
				async (settings) => env.configure(settings),
			),
		},
		"/api/sync/run": {
			PUT: write(
				(body) => checked(parseSyncRun(body), "Expected { choices }"),
				(choices) => env.sync(choices),
			),
		},
		/** `{ name }`: creates the private GitHub repository, or takes the signed-in account's own, and saves it as the remote. */
		"/api/sync/create-repo": {
			PUT: write(
				(body) => checked(parseSyncRepoName(body), "Expected { name } naming a GitHub repository as name or owner/name"),
				(name) => env.createRemote(name),
			),
		},
	};
}
