import { cooldownDirectory, GitHubAccess, quotaReset } from "./access";
import { CommandError, type CommandOutput, GH, type Gh, ghJson, ghText, parsedAnswer } from "./command";

/** A credential gh holds for a host, as `gh auth status --json hosts` reports it; the report carries no token. */
export interface GhCredential {
	host: string;
	/** `success`, `error` when GitHub rejects it, or `timeout`. */
	state: string;
	/** Whether gh uses it for the host. */
	active: boolean;
	login: string;
	/** The environment variable gh read it from, such as `GITHUB_TOKEN`, or the store it sits in, such as `keyring`. */
	tokenSource: string;
}

/** How `gh auth status` names a token source that is an environment variable, such as `GITHUB_TOKEN`, rather than a store such as `keyring`. */
export const TOKEN_VARIABLE = /^[A-Z][A-Z0-9_]*$/;

/** The credential gh uses that GitHub rejects, else `undefined`. */
export function rejectedCredential(credentials: GhCredential[]): GhCredential | undefined {
	return credentials.find(c => c.active && c.state === "error");
}

/** The environment variable holding a token GitHub rejects ahead of a stored gh login it accepts, else `undefined`. */
function overriddenLogin(credentials: GhCredential[]): string | undefined {
	const rejected = rejectedCredential(credentials);
	return rejected && TOKEN_VARIABLE.test(rejected.tokenSource) && credentials.some(c => c.host === rejected.host && c.state === "success") ? rejected.tokenSource : undefined;
}

/** Each credential in a `gh auth status --json hosts` report, else `undefined` when `report` is not one. */
function credentialsOf(report: unknown): GhCredential[] | undefined {
	const hosts = report && typeof report === "object" && "hosts" in report ? report.hosts : undefined;
	if (!hosts || typeof hosts !== "object") return undefined;
	const credentials: GhCredential[] = [];
	for (const entry of Object.values(hosts).flat()) {
		if (!entry || typeof entry !== "object") return undefined;
		const [host, state, active, login, tokenSource] = ["host", "state", "active", "login", "tokenSource"].map(field => Reflect.get(entry, field));
		if (typeof host !== "string" || typeof state !== "string" || typeof active !== "boolean" || typeof tokenSource !== "string") return undefined;
		credentials.push({ host, state, active, login: typeof login === "string" ? login : "", tokenSource });
	}
	return credentials;
}

/** An extension's `pi.exec`; `killed` is set when `timeout` or `signal` ended the command. */
export type Exec = (command: string, args: string[], options: { cwd: string; timeout: number; signal: AbortSignal }) => Promise<CommandOutput & { killed?: boolean }>;

/** How long gh may run before the runner kills it. */
const GH_TIMEOUT = 20_000;
/** How long past its timeout the runner waits for `exec` to report a killed gh before giving up on it. */
const KILL_GRACE = 2_000;

/**
 * How an extension runs gh: under the shared quota cooldowns, and without an environment token GitHub rejects ahead of a stored login that works,
 * such as a project `.env`'s `GITHUB_TOKEN`, which the agent's own `env -u` cannot remove from omp's process.
 */
export class GhRunner {
	readonly #exec: Exec;
	/** The environment variables gh runs without. */
	readonly #unset: string[] = [];
	/** Keyed on the credential gh runs with, so a dropped token's cooldowns give way to those the stored login shares with the dashboard. */
	#access = new GitHubAccess();

	readonly #timeout: number;

	constructor(exec: Exec, timeout = GH_TIMEOUT) {
		this.#exec = exec;
		this.#timeout = timeout;
	}

	/** `gh args`'s stdout, run again once after dropping a rejected environment token. @throws CommandError or GitHubQuotaError. */
	async text(args: string[], cwd: string): Promise<string> {
		const run: Gh = words => this.#run(words, cwd);
		const budget = args[0] === "api" && args[1] !== "graphql" ? "rest" : "graphql";
		const load = () => this.#access.request(budget, () => ghText(run, args), async () => quotaReset(await ghJson(run, ["api", "rate_limit"]), budget));
		const unset = this.#unset.length;
		try {
			return await load();
		} catch (error) {
			if (!(error instanceof CommandError && /\bHTTP 401\b/.test(error.message))) throw error;
			// A concurrent call may already have dropped the token this one ran with.
			if (unset === this.#unset.length && !(await this.#dropRejectedToken(cwd))) throw error;
			return load();
		}
	}

	/** `gh args`'s stdout parsed as JSON; fails as {@link text} does. */
	async json(args: string[], cwd: string): Promise<unknown> {
		return JSON.parse(await this.text(args, cwd));
	}

	/** Each credential gh holds, else `undefined` when gh does not report them. */
	async credentials(cwd: string): Promise<GhCredential[] | undefined> {
		return credentialsOf(parsedAnswer((await this.#run(["auth", "status", "--json", "hosts"], cwd)).stdout));
	}

	async #dropRejectedToken(cwd: string): Promise<boolean> {
		const variable = overriddenLogin((await this.credentials(cwd)) ?? []);
		if (!variable) return false;
		this.#unset.push(variable);
		this.#access = new GitHubAccess(cooldownDirectory(this.#unset));
		return true;
	}

	/** @throws CommandError naming the gh subcommand when gh outlives the timeout; it returns by `KILL_GRACE` after it even when `exec` has not reaped gh. */
	async #run(args: string[], cwd: string): Promise<CommandOutput> {
		const [command, prefix] = this.#unset.length ? ["env", [...this.#unset.flatMap(name => ["-u", name]), GH]] : [GH, []];
		const timedOut = () => new CommandError(`gh ${args.slice(0, 2).filter(arg => !arg.startsWith("-")).join(" ")} timed out after ${Math.round(this.#timeout / 1000)}s`, undefined);
		// Aborting makes exec kill gh even when its own timer is late; the deadline keeps the call prompt when exec still waits on gh's tree.
		const abort = new AbortController();
		const { promise: deadline, reject } = Promise.withResolvers<never>();
		const killer = setTimeout(() => abort.abort(), this.#timeout);
		const giveUp = setTimeout(() => reject(timedOut()), this.#timeout + KILL_GRACE);
		try {
			const output = await Promise.race([this.#exec(command, [...prefix, ...args], { cwd, timeout: this.#timeout, signal: abort.signal }), deadline]);
			if (output.killed) throw timedOut();
			return output;
		} finally {
			clearTimeout(killer);
			clearTimeout(giveUp);
		}
	}
}
