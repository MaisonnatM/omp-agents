/** The Memory module's server half: every workspace repository's project memory, the bookmarks, and the `bookmarks` tool's extension. See docs/architecture/memory-page.md. */
import { join } from "node:path";
import { Bookmarks, zenDir, zenProfileDir } from "./bookmarks";
import type { ModuleCore, ServerModule } from "./modules";
import { BOOKMARKS_FLAGS } from "./omp/bookmarks-extension";
import { dataDir, HOME } from "./paths";
import { editProjectMemory, MemoryEditRefused, projectMemoryView } from "./project-memory";
import { fail } from "./server/http";
import { shippedFile } from "./server/resources";
import type { RouteKit, Routes } from "./server/route-kit";
import { repositoriesOf } from "./source-control";

/** The x.com bookmarks of the last sync, and how it went. */
const X_FILE = join(dataDir, "bookmarks-x.json");
/** The omp extension every session loads, which gives it the `bookmarks` tool. */
const BOOKMARKS_EXTENSION = { source: join(import.meta.dir, "omp", "bookmarks-extension.ts"), bundle: "bookmarks-extension.js" };

const bookmarks = new Bookmarks({ profileDir: () => zenProfileDir(zenDir(HOME)), xFile: X_FILE, fetch: (url, init) => fetch(url, init) });

/** `GET` and `PUT /api/project-memory`, and `GET /api/bookmarks` and `POST /api/bookmarks/x-sync`. */
export function memoryRoutes({ get, write }: RouteKit, core: ModuleCore, store: Bookmarks): Routes {
	const roots = () => repositoriesOf(core.workspaces());
	return {
		"/api/project-memory": {
			GET: get(async () => Response.json(projectMemoryView(await roots()))),
			PUT: write(
				body => body,
				async body => editProjectMemory(await roots(), body),
				err => (err instanceof MemoryEditRefused ? fail(400, err.message) : null),
			),
		},
		"/api/bookmarks": { GET: get(async () => Response.json(store.view())) },
		"/api/bookmarks/x-sync": { POST: write(() => null, () => store.syncX()) },
	};
}

export const MEMORY_MODULE: ServerModule<"memory"> = {
	id: "memory",
	join: { rpc: { args: ["-e", shippedFile(BOOKMARKS_EXTENSION), `--${BOOKMARKS_FLAGS.xFile}`, X_FILE], tools: [] }, attach() {} },
	routes: (kit, core) => memoryRoutes(kit, core, bookmarks),
	shipped: [BOOKMARKS_EXTENSION],
};
