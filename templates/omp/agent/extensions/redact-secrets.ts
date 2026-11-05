// Removes secrets the user pasted, such as API keys, passwords, and database URLs with a password, from what omp keeps
// of the session on disk once each turn ends: the session file, its sidecar folder, and its
// rows in history.db. Each becomes `[redacted secret: <what it was>]`. The running agent keeps the real value for the
// rest of the session, since only copies are changed; a resumed session reads the placeholder.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { SessionScrub, type SessionStore } from "./redact-secrets/scrub";

/**
 * Where omp keeps `history.db`, as omp's own `getHistoryDbPath` decides: on Linux and
 * macOS, `$XDG_DATA_HOME/omp` once `omp config init-xdg` made it, for the default agent directory, or
 * `$XDG_DATA_HOME/omp/profiles/<name>` once made, for a profile's; otherwise the agent directory.
 */
export function dataDir(agentDir: string, env: NodeJS.ProcessEnv = process.env): string {
	const xdg = env.XDG_DATA_HOME;
	if (!xdg || (process.platform !== "linux" && process.platform !== "darwin")) return agentDir;
	const dir = resolve(agentDir);
	const root = dirname(dir);
	const base = join(homedir(), ".omp");
	let xdgDir: string;
	if (dir === join(base, "agent")) xdgDir = join(xdg, "omp");
	else if (basename(dir) === "agent" && dirname(root) === join(base, "profiles")) xdgDir = join(xdg, "omp", "profiles", basename(root));
	else return agentDir;
	return existsSync(xdgDir) ? xdgDir : agentDir;
}

export default function redactSecrets(pi: ExtensionAPI) {
	const data = dataDir(pi.pi.getAgentDir());
	const scrubs = new Map<string, SessionScrub>();
	let queue: Promise<void> = Promise.resolve();

	const scrub = (ctx: ExtensionContext): Promise<void> => {
		// The context's manager is omp's whole `SessionManager`, typed read-only; `rewriteEntries` is its own rewrite.
		const store = ctx.sessionManager as unknown as SessionStore;
		queue = queue
			.then(async () => {
				if (typeof store.rewriteEntries !== "function") {
					pi.logger.warn("redact-secrets: this omp has no SessionManager.rewriteEntries; secrets stay in the session file");
					return;
				}
				const sessionId = store.getSessionId();
				let session = scrubs.get(sessionId);
				if (!session) {
					session = new SessionScrub({ historyDb: join(data, "history.db"), leaseHeld: pi.pi.isSessionLeaseHeld });
					scrubs.set(sessionId, session);
				}
				const report = await session.run(store);
				if (report.entries + report.files + report.historyRows > 0) pi.logger.debug("redact-secrets: replaced secrets", { sessionId, ...report });
			})
			.catch(error => pi.logger.warn("redact-secrets: scrub failed", { error: error instanceof Error ? error.message : String(error) }));
		return queue;
	};

	// `agent_end` also fires before omp continues on its own, with retries or queued messages; the turn ends when it does not.
	pi.on("agent_end", (event, ctx) => (event.willContinue ? undefined : scrub(ctx)));
	// omp waits for this one, so `omp -p` and a closing session finish the scrub before the process exits.
	pi.on("session_shutdown", (_event, ctx) => scrub(ctx));
}
