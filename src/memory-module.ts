/** The Memory module's server half: every workspace repository's project memory, the bookmarks, and the `bookmarks` tool's extension. See docs/architecture/memory-page.md. */
import { join } from "node:path";
import { Bookmarks } from "./bookmarks/service";
import { readXVideo } from "./bookmarks/x-video";
import { zenDir, zenProfileDir } from "./bookmarks/zen";
import type { ModuleCore, ServerModule } from "./modules";
import { BOOKMARKS_FLAGS } from "./omp/bookmarks-extension";
import { glossaryView } from "./glossary";
import { dataDir, HOME } from "./paths";
import { EDIT_SHAPE, editProjectMemory, MemoryEditRefused, parseEdit, projectMemoryView } from "./project-memory";
import { fail } from "./server/http";
import { shippedFile } from "./server/resources";
import type { RouteKit, Routes } from "./server/route-kit";
import { repositoriesOf } from "./source-control";

/** The x.com bookmarks of the last sync, and how it went. */
const X_FILE = join(dataDir, "bookmarks-x.json");
/** The omp extension every session loads, which gives it the `bookmarks` tool. */
const BOOKMARKS_EXTENSION = { source: join(import.meta.dir, "omp", "bookmarks-extension.ts"), bundle: "bookmarks-extension.js" };

/** `GET` and `PUT /api/project-memory`, `GET /api/glossary`, and `GET /api/bookmarks`, `POST /api/bookmarks/x-sync`, and `GET /api/bookmarks/x-video`. */
export function memoryRoutes({ get, media, write }: RouteKit, core: ModuleCore): Routes {
	const roots = () => repositoriesOf(core.workspaces());
	const xFetch = (url: string, init?: RequestInit) => fetch(url, init);
	const bookmarks = new Bookmarks({ profileDir: () => zenProfileDir(zenDir(HOME)), xFile: X_FILE, fetch: xFetch });
	return {
		"/api/project-memory": {
			GET: get(async () => Response.json(projectMemoryView(await roots()))),
			PUT: write(
				body => parseEdit(body) ?? fail(400, EDIT_SHAPE),
				async edit => editProjectMemory(await roots(), edit),
				err => (err instanceof MemoryEditRefused ? fail(400, err.message) : null),
			),
		},
		"/api/glossary": { GET: get(async () => Response.json(glossaryView(await roots()))) },
		"/api/bookmarks": { GET: get(async () => Response.json(bookmarks.view())) },
		"/api/bookmarks/x-sync": { POST: write(() => null, () => bookmarks.syncX()) },
		"/api/bookmarks/x-video": { GET: media((params, req) => readXVideo(xFetch, params.get("url"), req.headers.get("range"))) },
	};
}

export const MEMORY_MODULE: ServerModule<"memory"> = {
	id: "memory",
	join: { rpc: { args: ["-e", shippedFile(BOOKMARKS_EXTENSION), `--${BOOKMARKS_FLAGS.xFile}`, X_FILE], tools: [] }, attach() {} },
	routes: memoryRoutes,
	shipped: [BOOKMARKS_EXTENSION],
};
