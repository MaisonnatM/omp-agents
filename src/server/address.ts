/**
 * Where the server listens and how it says so. The desktop shell (desktop/main.ts) imports this too, so it finds the
 * server the same way the server places itself; it must stay free of Bun APIs.
 */

export const HOSTNAME = "127.0.0.1";
/** The window event the desktop shell's quick-capture shortcut dispatches; the page answers by opening the command palette, where Create todo is. */
export const QUICK_TODO_EVENT = "omp-quick-todo";

/** `PORT`, else 4317. */
export const portFromEnv = (): number => Number(process.env.PORT ?? 4317);

/** The address the page is served at. */
export const originOf = (port: number): string => `http://${HOSTNAME}:${port}`;

/** The `Host` values the server answers to. */
export const dashboardHosts = (port: number): string[] => [`${HOSTNAME}:${port}`, `localhost:${port}`];

/** The line the server prints once it listens, which the desktop shell waits for. */
export const listeningLine = (port: number, ompVersion: string): string => `omp-agents (omp v${ompVersion}) on ${originOf(port)}`;

/** Whether `line` is {@link listeningLine} for `port`, whatever omp version the server runs. */
export const isListeningLine = (line: string, port: number): boolean =>
	line.startsWith("omp-agents (omp v") && line.endsWith(` on ${originOf(port)}`);
