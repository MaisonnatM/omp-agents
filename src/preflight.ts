/**
 * Checks what the server needs before it loads anything else: a recent enough Bun and an installed omp.
 * `src/server.ts` imports it first, so a missing requirement prints one line saying how to fix it instead of a stack trace.
 */
import { errorText } from "./json";

const MIN_BUN = "1.4.0";

function fail(message: string): never {
	console.error(`omp-agents: ${message}`);
	process.exit(1);
}

if (!Bun.semver.satisfies(Bun.version, `>=${MIN_BUN}`)) fail(`Bun ${MIN_BUN} or later is required, and this is Bun ${Bun.version}; run \`bun upgrade\`.`);

try {
	// Dynamic, because a static import's throw cannot be caught: this module resolves omp as it loads.
	await import("./omp/install");
} catch (err) {
	fail(errorText(err));
}
