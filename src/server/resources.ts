/**
 * Where the server finds the files it ships beside its code: the page and the omp templates. A packaged app names its
 * resources directory in `OMP_AGENTS_RESOURCES`, which `scripts/build-desktop-artifact.ts` fills; a checkout leaves it unset.
 */
import { join } from "node:path";

/** The packaged app's resources directory, or `null` when the server runs from a checkout. */
export const packagedResources: string | null = process.env.OMP_AGENTS_RESOURCES || null;

/** The prebuilt page of a packaged app. A checkout builds `web/index.html` at startup instead. */
export const prebuiltPageDir: string | null = packagedResources && join(packagedResources, "page");

/** The omp starter kit: `templates/omp` in a checkout, its copy in a packaged app. */
export const ompTemplateDir: string = join(packagedResources ?? join(import.meta.dir, "..", ".."), "templates", "omp");
