/** The Sport module's server half: `sport.json`, the `sport` tool's inbox and extension, and the demo thumbnails. See docs/architecture/sport.md. */
import { join } from "node:path";
import type { StoredModule } from "./modules";
import { SPORT_FLAGS } from "./omp/sport-extension";
import { configDir, dataDir } from "./paths";
import { shippedFile } from "./server/resources";
import { SportFile } from "./server/sport-file";
import { SportInbox } from "./server/sport-inbox";
import { sportThumbRoutes } from "./server/sport-thumbs";
import type { SportChange, SportState } from "./shared/sport";
import { parseSportChange } from "./sport-parse";

/** The plan, measurements, and workout log. */
const SPORT_FILE = join(configDir, "sport.json");
/** Where the `sport` tool leaves its changes, one JSON file each, so the server stays the only writer of {@link SPORT_FILE}. */
const SPORT_INBOX = join(configDir, "sport-inbox");
/** The demo thumbnails YouTube served once, `<video id>.jpg` each. */
const SPORT_THUMBS = join(dataDir, "sport-thumbs");
/** The omp extension every session loads, which gives it the `sport` tool. */
const SPORT_EXTENSION = { source: join(import.meta.dir, "omp", "sport-extension.ts"), bundle: "sport-extension.js" };

export const SPORT_MODULE: StoredModule<"sport", SportState, SportChange[]> = {
	id: "sport",
	store: {
		open: () => new SportFile(SPORT_FILE),
		parse(changes) {
			if (!Array.isArray(changes) || changes.length === 0) return null;
			const parsed: SportChange[] = [];
			for (const value of changes) {
				const change = parseSportChange(value);
				if (!("ok" in change)) return null;
				parsed.push(change.ok);
			}
			return parsed;
		},
		inbox: (state, apply, options) => new SportInbox(SPORT_INBOX, state, apply, options),
	},
	join: { rpc: { args: ["-e", shippedFile(SPORT_EXTENSION), `--${SPORT_FLAGS.file}`, SPORT_FILE, `--${SPORT_FLAGS.inbox}`, SPORT_INBOX], tools: [] }, attach() {} },
	routes: kit => sportThumbRoutes(kit, { dir: SPORT_THUMBS, fetch: url => fetch(url) }),
	shipped: [SPORT_EXTENSION],
};
