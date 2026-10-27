// Adds an `Omp-Session: <session id>` trailer to every commit an omp session makes, so `git log` leads back to it.
// omp's bash tool sets PI_SESSION_ID in each command's env; a config-based git hook, which runs beside the repo's own
// hooks even under `core.hooksPath`, reads it. The `f() {...}; f` wrapper is needed because git appends the hook's args.
// The hook travels in GIT_CONFIG_PARAMETERS, the variable `git -c` fills, not GIT_CONFIG_COUNT: a `.env` file that sets
// GIT_CONFIG_COUNT, as test setups do, never overrides an inherited one, so taking it would drop that file's entries.

const COMMAND =
	'f() { [ -z "$PI_SESSION_ID" ] || git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Omp-Session: $PI_SESSION_ID" "$1"; }; f';
const KEY = "'hook.omp-session.command'=";

/** GIT_CONFIG_PARAMETERS with the hook appended to the entries already in `env`, or `undefined` when it is there. */
export function trailerParameters(env: NodeJS.ProcessEnv): string | undefined {
	const current = env.GIT_CONFIG_PARAMETERS ?? "";
	if (current.includes(KEY)) return undefined;
	const hook = `'hook.omp-session.event'='prepare-commit-msg' ${KEY}'${COMMAND}'`;
	return current ? `${current} ${hook}` : hook;
}

// omp passes the extension API, which this needs nothing from.
export default function sessionTrailer() {
	const parameters = trailerParameters(process.env);
	if (parameters) process.env.GIT_CONFIG_PARAMETERS = parameters;
}
