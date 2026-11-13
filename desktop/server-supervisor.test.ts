import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/git";
import { listeningLine } from "../src/server/address";
import { type Move, UpdateJournal } from "../src/server/update-journal";
import { OMP_MISSING_EXIT } from "../src/shared/startup";
import { afterLoss, RESTART_POLICY } from "./restart-policy";
import { ServerSupervisor, type SupervisorEvent } from "./server-supervisor";

const PORT = 47_317;
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-supervisor-"));
	dirs.push(dir);
	return dir;
}

/** A server that runs `script` under this Bun from `cwd`. */
const serverOf = (script: string, cwd = tmpdir()) => ({ bun: process.execPath, args: ["-e", script], cwd, env: {}, port: PORT });
/** A server that listens, then exits with code 1 after 40 ms. */
const crashing = `console.log(${JSON.stringify(listeningLine(PORT, "1.0.0"))}); setTimeout(() => process.exit(1), 40);`;

const headOf = async (dir: string): Promise<string> => (await git(dir, "rev-parse", "HEAD")).trim();

/**
 * A checkout of `main` an update moved from a `server.ts` that listens to one that runs `next`, handed over to the
 * update's first start.
 */
async function handedOver(next: string): Promise<{ dir: string; move: Move; journal: UpdateJournal }> {
	const dir = scratch();
	await git(dir, "init", "--quiet", "--initial-branch=main");
	const commit = async (text: string): Promise<string> => {
		writeFileSync(join(dir, "server.ts"), text);
		await git(dir, "add", "server.ts");
		await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "server");
		return headOf(dir);
	};
	const from = await commit(`console.log(${JSON.stringify(listeningLine(PORT, "1.0.0"))}); setInterval(() => {}, 1000);`);
	const move = { branch: "main", from, to: await commit(next), lockChanged: false };
	const journal = (await UpdateJournal.at(dir, PORT, process.execPath))!;
	journal.handOver(move);
	return { dir, move, journal };
}

/** Starts `supervisor` and resolves with every event, with when it came, up to the first that is not `listening`. */
function eventsUntilDone(supervisor: ServerSupervisor): Promise<{ event: SupervisorEvent; at: number }[]> {
	const events: { event: SupervisorEvent; at: number }[] = [];
	const { promise, resolve } = Promise.withResolvers<typeof events>();
	supervisor.start(event => {
		events.push({ event, at: performance.now() });
		if (event.kind !== "listening") resolve(events);
	});
	return promise;
}

describe("afterLoss", () => {
	test("waits 1, 2, 5, then 15 s, and gives up at the 5th stop within 5 minutes", () => {
		let losses: readonly number[] = [];
		const waits: (number | "give-up")[] = [];
		for (const at of [0, 10_000, 20_000, 30_000, 40_000]) {
			const next = afterLoss(losses, at);
			losses = next.losses;
			waits.push(next.kind === "restart" ? next.delayMs : next.kind);
		}
		expect(waits).toEqual([1_000, 2_000, 5_000, 15_000, "give-up"]);
	});

	test("forgets stops older than the window", () => {
		const losses = [0, 1_000, 2_000, 3_000];
		expect(afterLoss(losses, RESTART_POLICY.windowMs + 2_500)).toEqual({ kind: "restart", delayMs: 2_000, losses: [3_000, RESTART_POLICY.windowMs + 2_500] });
	});
});

describe("ServerSupervisor", () => {
	test("restarts a server that stops after it listened, after the first wait, and gives up at the 5th stop within the window", async () => {
		const supervisor = new ServerSupervisor({ command: serverOf(crashing), checkout: null, policy: { delaysMs: [400, 10, 10, 10], windowMs: 60_000 } });
		const events = await eventsUntilDone(supervisor);
		expect(events.map(({ event }) => event.kind)).toEqual(["listening", "listening", "listening", "listening", "listening", "failed"]);
		expect(events.at(-1)?.event).toMatchObject({ title: "The server stopped" });
		expect(events[1]!.at - events[0]!.at).toBeGreaterThanOrEqual(400);
		await supervisor.stop();
		expect(supervisor.running).toBe(false);
	});

	test("says at once why a server that never listened did not start, or that omp is missing", async () => {
		const broken = new ServerSupervisor({ command: serverOf(`console.error("SyntaxError: Unexpected token"); process.exit(1);`), checkout: null });
		expect((await eventsUntilDone(broken)).map(({ event }) => event)).toEqual([{ kind: "failed", title: "The server did not start", detail: "The server exited with code 1." }]);
		expect(broken.log).toEqual(["SyntaxError: Unexpected token"]);

		const noOmp = new ServerSupervisor({ command: serverOf(`process.exit(${OMP_MISSING_EXIT});`), checkout: null });
		expect((await eventsUntilDone(noOmp)).map(({ event }) => event)).toEqual([{ kind: "omp-missing" }]);
	});

	test("stops a server that prints no listening line in time", async () => {
		const supervisor = new ServerSupervisor({ command: serverOf("setInterval(() => {}, 1000);"), checkout: null, readyTimeoutMs: 200 });
		expect((await eventsUntilDone(supervisor)).map(({ event }) => event)).toEqual([{ kind: "failed", title: "The server did not start", detail: "The server did not answer within 0.2 s." }]);
	});

	test("a start while a restart waits starts the server now", async () => {
		const supervisor = new ServerSupervisor({ command: serverOf(crashing), checkout: null, policy: { delaysMs: [60_000], windowMs: 60_000 } });
		const listened = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
		let count = 0;
		const onEvent = (event: SupervisorEvent): void => {
			if (event.kind === "listening") listened[count++]?.resolve();
		};
		supervisor.start(onEvent);
		await listened[0]!.promise;
		// The child exits on its own clock 40 ms after it listened, and the 60 s wait that follows gives no sign to await.
		await Bun.sleep(300);
		supervisor.start(onEvent);
		await listened[1]!.promise;
		await supervisor.stop();
		expect(supervisor.running).toBe(false);
	});

	test("takes the checkout back to the commit that ran before when the update's build did not start, then starts that", async () => {
		const { dir, move, journal } = await handedOver(`throw new TypeError("boom");`);
		const supervisor = new ServerSupervisor({ command: { bun: process.execPath, args: ["server.ts"], cwd: dir, env: {}, port: PORT }, checkout: dir });
		const { promise: listening, resolve } = Promise.withResolvers<void>();
		supervisor.start(event => event.kind === "listening" && resolve());
		await listening;
		await supervisor.stop();
		expect(await headOf(dir)).toBe(move.from);
		expect(journal.read()).toMatchObject({ state: "rolled-back", move, failed: { failure: "exited with code 1", error: expect.stringContaining("TypeError: boom") } });
	});

	test("leaves the update alone when a server stops after it listened, before it announced a restart into the new build", async () => {
		const { dir, move, journal } = await handedOver(`throw new TypeError("boom");`);
		const supervisor = new ServerSupervisor({ command: serverOf(crashing, dir), checkout: dir, policy: { delaysMs: [10], windowMs: 60_000 } });
		expect((await eventsUntilDone(supervisor)).map(({ event }) => event.kind)).toEqual(["listening", "listening", "failed"]);
		expect(await headOf(dir)).toBe(move.to);
		expect(journal.read()).toEqual({ state: "starting", move });
	});
});
