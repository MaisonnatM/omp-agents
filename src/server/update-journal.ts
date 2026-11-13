/**
 * The update record: where **Update dashboard** stands in moving the checkout a server runs from, one file per port in
 * that checkout's git directory, and the rollback that takes the checkout back to the commit that ran before. The server
 * writes it around a move and clears it once the new build listens; the desktop shell recovers it after the server stops.
 * It uses no Bun APIs, since the desktop shell bundles it and runs it under Node.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteTextSync } from "../fs";
import { errorText, fields, isBoolean, isObject, isString, nullable, parseJson } from "../json";
import { shortCommit } from "../shared/dashboard-update";
import { gitCause } from "../shared/git";

/** One move of a checkout: its branch, the commit that ran, the commit it moves to, and whether `bun.lock` differs between them. */
export interface Move {
	branch: string;
	from: string;
	to: string;
	lockChanged: boolean;
}

/**
 * Why a build did not start: `failure`, how it ended in plain words such as `exited with code 1`, which the bell and
 * the command menu show; and `error`, the last error line it printed, which only the refusal of an update adds.
 */
export interface StartFailure {
	failure: string;
	error: string | null;
}

/**
 * Where a move stands. `moving`: the server moves the checkout and installs, and the old build still runs. `starting`:
 * the move is done, and the next start is `to`'s first. `reverting`: `to` did not start, as `failed` says, and the
 * checkout goes back to `from`. `rolled-back`: it went back, and **Update dashboard** refuses `to`.
 */
export type UpdateRecord = { state: "moving" | "starting"; move: Move } | { state: "reverting" | "rolled-back"; move: Move; failed: StartFailure };

/** A record that keeps why its build did not start; {@link UpdateJournal.blocking} answers only a `rolled-back` one. */
export type RolledBack = Extract<UpdateRecord, { failed: StartFailure }>;

/**
 * What a recovery did: nothing, since nothing was left to undo; `reverted` the checkout to `move.from`, `blocked` when
 * it left a `rolled-back` record; or got `stuck`, keeping the record so the next recovery tries again.
 */
export type Recovery = { kind: "none" } | { kind: "reverted"; move: Move; blocked: boolean } | { kind: "stuck"; move: Move; reason: string };

const isMove = fields<Move>({ branch: isString, from: isString, to: isString, lockChanged: isBoolean });
const isFailed = fields<StartFailure>({ failure: isString, error: nullable(isString) });
const isRecord = (value: unknown): value is UpdateRecord =>
	isObject(value) &&
	isMove(value.move) &&
	(value.state === "moving" || value.state === "starting" || ((value.state === "reverting" || value.state === "rolled-back") && isFailed(value.failed)));

const NONE: Recovery = { kind: "none" };
/** Long enough for a fetch; any git call that takes longer is stuck. */
export const GIT_TIMEOUT_MS = 60_000;
export const INSTALL_TIMEOUT_MS = 5 * 60_000;
/** Each server's record file, `update-<port>.json`, so {@link heldBack} finds every port's. */
const RECORD_FILE = { before: "update-", after: ".json" } as const;

interface Ran {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs `file` in `dir`; a command that did not run, timed out, or was aborted answers code -1 with why. */
function runIn(dir: string, file: string, args: string[], timeout: number, signal?: AbortSignal): Promise<Ran> {
	const { promise, resolve } = Promise.withResolvers<Ran>();
	execFile(file, args, { cwd: dir, timeout, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
		if (err === null) resolve({ code: 0, stdout, stderr });
		else resolve({ code: typeof err.code === "number" ? err.code : -1, stdout, stderr: stderr || err.message });
	});
	return promise;
}

/** git's answer in `dir`: its output on exit 0, `null` on exit 1 (a `--quiet` lookup that found nothing); any other exit throws. */
async function ask(dir: string, args: string[]): Promise<string | null> {
	const { code, stdout, stderr } = await runIn(dir, "git", args, GIT_TIMEOUT_MS);
	if (code === 0) return stdout.trim();
	if (code === 1) return null;
	throw new Error(`git ${args[0]} failed in ${dir}: ${gitCause(stderr) ?? `exit code ${code}`}`);
}

/** The directory that holds the update records of `dir`'s worktree, inside its git directory; `null` outside a git checkout. */
async function recordsDirOf(dir: string): Promise<string | null> {
	const { code, stdout } = await runIn(dir, "git", ["rev-parse", "--path-format=absolute", "--git-path", "omp-agents"], GIT_TIMEOUT_MS);
	return code === 0 ? stdout.trim() : null;
}

function readRecord(file: string): UpdateRecord | null {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return null;
	}
	const record = parseJson(text);
	return isRecord(record) ? record : null;
}

/** `record` when it is a rollback that holds the checkout off `remote`, since `remote` is the commit that did not start. */
const blockingIn = (record: UpdateRecord | null, remote: string): RolledBack | null => (record?.state === "rolled-back" && record.move.to === remote ? record : null);

/** The update record of one server: the checkout it runs from and its port, so servers beside each other keep their own. */
export class UpdateJournal {
	readonly #dir: string;
	readonly #file: string;
	readonly #bun: string;

	private constructor(dir: string, file: string, bun: string) {
		this.#dir = dir;
		this.#file = file;
		this.#bun = bun;
	}

	/** The record of the server on `port` that runs from `dir`, which reinstalls with `bun`; `null` when `dir` is in no git checkout. */
	static async at(dir: string, port: number, bun: string): Promise<UpdateJournal | null> {
		const records = await recordsDirOf(dir);
		return records === null ? null : new UpdateJournal(dir, join(records, `${RECORD_FILE.before}${port}${RECORD_FILE.after}`), bun);
	}

	/** The record as it stands; `null` when there is none, or one this build cannot read. */
	read(): UpdateRecord | null {
		return readRecord(this.#file);
	}

	/** Before the checkout moves: a `moving` record, which replaces a `rolled-back` one. */
	begin(move: Move): void {
		this.#write({ state: "moving", move });
	}

	/** Once the checkout moved and installed: the next start is `to`'s first. */
	handOver(move: Move): void {
		this.#write({ state: "starting", move });
	}

	/**
	 * Once the server running `running` listens: clears a `moving` or `starting` record, and a `rolled-back` one once the
	 * checkout left `from`. `true` when this start is an update's first, of the commit it moved to.
	 */
	started(running: string): boolean {
		const record = this.read();
		if (record === null || record.state === "reverting") return false;
		if (record.state === "rolled-back") {
			if (running !== record.move.from) this.#clear();
			return false;
		}
		this.#clear();
		return record.state === "starting" && running === record.move.to;
	}

	/** The rolled-back update whose commit, origin's `remote`, did not start, which **Update dashboard** refuses until origin moves past it. */
	blocking(remote: string): RolledBack | null {
		return blockingIn(this.read(), remote);
	}

	/**
	 * After the server stopped, `failed` saying why when it stopped before it listened: takes the checkout back to the
	 * commit that ran before when a move was cut short, or when the build it moved to did not start. Each step follows from
	 * the checkout as it is, so a recovery cut short finishes on the next one, whatever that one is passed.
	 */
	async recover(failed: StartFailure | null, signal?: AbortSignal): Promise<Recovery> {
		const record = this.read();
		if (record === null) return NONE;
		switch (record.state) {
			case "rolled-back":
				return NONE;
			case "starting":
				if (failed === null) return NONE;
				return this.#revert(this.#write({ state: "reverting", move: record.move, failed }), signal);
			case "moving":
			case "reverting":
				return this.#revert(record, signal);
			default: {
				const never: never = record;
				throw new Error(`Unknown update record ${String(never)}`);
			}
		}
	}

	/**
	 * Resets to `from` only while HEAD is `to` on the move's branch, and `--keep` refuses rather than touch a file changed
	 * since; HEAD already at `from` goes on to the install. Anywhere else the checkout moved on by hand, so the record goes.
	 */
	async #revert(record: UpdateRecord, signal?: AbortSignal): Promise<Recovery> {
		const { move } = record;
		try {
			const [branch, head] = await Promise.all([ask(this.#dir, ["symbolic-ref", "--short", "--quiet", "HEAD"]), ask(this.#dir, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])]);
			if (branch !== move.branch || (head !== move.to && head !== move.from)) {
				this.#clear();
				return NONE;
			}
			if (head === move.to) {
				const reset = await runIn(this.#dir, "git", ["reset", "--keep", "--quiet", move.from], GIT_TIMEOUT_MS, signal);
				if (reset.code !== 0) return { kind: "stuck", move, reason: `${this.#dir} could not go back to ${shortCommit(move.from)}: ${gitCause(reset.stderr) ?? `exit code ${reset.code}`} Commit or discard the change, then retry.` };
			}
			if (move.lockChanged) {
				const install = await runIn(this.#dir, this.#bun, ["install", "--frozen-lockfile"], INSTALL_TIMEOUT_MS, signal);
				if (install.code !== 0) return { kind: "stuck", move, reason: `bun install --frozen-lockfile failed in ${this.#dir}: ${gitCause(install.stderr) ?? `exit code ${install.code}`}` };
			}
		} catch (err) {
			return { kind: "stuck", move, reason: errorText(err) };
		}
		if (!("failed" in record)) {
			this.#clear();
			return { kind: "reverted", move, blocked: false };
		}
		this.#write({ ...record, state: "rolled-back" });
		return { kind: "reverted", move, blocked: true };
	}

	#write<T extends UpdateRecord>(record: T): T {
		mkdirSync(dirname(this.#file), { recursive: true });
		atomicWriteTextSync(this.#file, `${JSON.stringify(record, null, "\t")}\n`);
		return record;
	}

	#clear(): void {
		rmSync(this.#file, { force: true });
	}
}

/**
 * The rolled-back update that holds `checkout` off `remote`, on any port: auto-pull moving it there would only run the
 * build that did not start. `null` when none does.
 */
export async function heldBack(checkout: string, remote: string): Promise<RolledBack | null> {
	const records = await recordsDirOf(checkout);
	if (records === null) return null;
	let files: string[];
	try {
		files = readdirSync(records);
	} catch {
		return null;
	}
	for (const file of files.filter(name => name.startsWith(RECORD_FILE.before) && name.endsWith(RECORD_FILE.after))) {
		const record = blockingIn(readRecord(join(records, file)), remote);
		if (record) return record;
	}
	return null;
}
