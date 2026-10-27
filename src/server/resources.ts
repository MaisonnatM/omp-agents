/**
 * Where the server finds the files it ships beside its code: the page, the session keeper, the session visuals
 * extension, and the omp templates. A packaged app names its resources directory in `OMP_AGENTS_RESOURCES`, which
 * `scripts/build-desktop-artifact.ts` fills; a checkout leaves it unset.
 */
import { join } from "node:path";

/** The packaged app's resources directory, or `null` when the server runs from a checkout. */
export const packagedResources: string | null = process.env.OMP_AGENTS_RESOURCES || null;

/** The prebuilt page of a packaged app. A checkout builds `web/index.html` at startup instead. */
export const prebuiltPageDir: string | null = packagedResources && join(packagedResources, "page");

/** The checkout that holds the server's code, which it builds the page from and **Update dashboard** fast-forwards. */
export const sourceDir: string = join(import.meta.dir, "..", "..");

/** The omp starter kit: `templates/omp` in a checkout, its copy in a packaged app. */
export const ompTemplateDir: string = join(packagedResources ?? sourceDir, "templates", "omp");

/** The script each session's keeper runs (`src/keeper.ts`): its bundle in a packaged app. */
export const keeperScript: string = packagedResources ? join(packagedResources, "keeper.js") : join(import.meta.dir, "..", "keeper.ts");

/** The omp extension every session the dashboard starts loads (`src/omp/session-visuals-extension.ts`): its bundle in a packaged app. */
export const sessionVisualsExtension: string = packagedResources
	? join(packagedResources, "session-visuals-extension.js")
	: join(import.meta.dir, "..", "omp", "session-visuals-extension.ts");

/** The omp extension a Bot's session loads (`src/omp/bot-extension.ts`): its bundle in a packaged app. */
export const botExtension: string = packagedResources ? join(packagedResources, "bot-extension.js") : join(import.meta.dir, "..", "omp", "bot-extension.ts");
