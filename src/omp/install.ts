/** The one omp installation this process uses for modules and CLI commands. */
import { resolveOmp } from "./resolve";

const installed = resolveOmp();
export const packageDir: string = installed.packageDir;
export const ompVersion: string = installed.version;
/** Runs this same package's CLI, including when OMP_PACKAGE_DIR overrides PATH. */
export const ompCommand: string[] = installed.command;
