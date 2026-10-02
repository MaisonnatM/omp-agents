import { homedir } from "node:os";

export const HOME = homedir();

/** `path` with the home directory shortened to `~`. */
export const displayPath = (path: string): string =>
	path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
