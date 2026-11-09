import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isObject } from "../json";
import { ompSandboxes, parseOvnfsRecord, servedPath } from "./isolation";
import { ovnfsTask } from "./modules";

const dirs: string[] = [];
const daemons: FakeDaemon[] = [];
afterEach(async () => {
	await Promise.all(daemons.splice(0).map(daemon => daemon.stop()));
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-ovnfs-")));
	dirs.push(dir);
	return dir;
}

const frame = (value: object): Buffer => {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	const header = Buffer.alloc(4);
	header.writeUInt32LE(body.length, 0);
	return Buffer.concat([header, body]);
};

interface FakeDaemon {
	/** The checkout names `rm` removed. */
	removed: string[];
	stop(): Promise<void>;
}

/** An ovnfs daemon on `socket` speaking admin protocol 5: `ls` lists `checkouts`, `rm` deletes a listed one's folder or answers `not_found`. */
async function fakeDaemon(socket: string, checkouts: { name: string; path: string }[]): Promise<FakeDaemon> {
	const removed: string[] = [];
	const clients = new Set<Socket>();
	const answer = (message: Record<string, unknown>): object => {
		if ("hello" in message) return { welcome: { version: 5, ops: ["ls", "rm"] } };
		if ("ls" in message) return { id: message.id, ok: { checkouts, snapshots: [] } };
		const name = isObject(message.rm) ? message.rm.checkout : undefined;
		const index = checkouts.findIndex(entry => entry.name === name);
		if (index < 0) return { id: message.id, error: { code: "not_found", message: `no checkout ${String(name)}` } };
		const [entry] = checkouts.splice(index, 1);
		rmSync(entry!.path, { recursive: true, force: true });
		removed.push(entry!.name);
		return { id: message.id, ok: {} };
	};
	const server: Server = createServer(conn => {
		clients.add(conn);
		conn.on("close", () => clients.delete(conn));
		let buffered = Buffer.alloc(0);
		conn.on("data", (chunk: Buffer) => {
			buffered = Buffer.concat([buffered, chunk]);
			while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32LE(0)) {
				const length = buffered.readUInt32LE(0);
				const message: unknown = JSON.parse(buffered.subarray(4, 4 + length).toString("utf8"));
				buffered = buffered.subarray(4 + length);
				if (isObject(message)) conn.write(frame(answer(message)));
			}
		});
	});
	const listening = Promise.withResolvers<void>();
	server.listen(socket, listening.resolve);
	await listening.promise;
	const daemon: FakeDaemon = {
		removed,
		stop: () => {
			const closed = Promise.withResolvers<void>();
			for (const client of clients) client.destroy();
			server.close(() => closed.resolve());
			return closed.promise;
		},
	};
	daemons.push(daemon);
	return daemon;
}

/** An `ovnfs` executable that logs each verb to `log` and reports the daemon on `socket` while that socket exists. */
function fakeCommand(dir: string, socket: string, mount: string): { command: string; verbs(): string[] } {
	const command = join(dir, "ovnfs");
	const log = join(dir, "verbs.log");
	writeFileSync(
		command,
		`#!/bin/sh\necho "$2" >> '${log}'\n[ "$2" = status ] && [ -S '${socket}' ] || exit 1\nprintf '%s' '${JSON.stringify({ version: 5, socket, mount })}'\n`,
	);
	chmodSync(command, 0o755);
	return { command, verbs: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

/** A sandbox under `dir` whose record names checkout `checkout` of `command`. */
function ovnfsSandbox(dir: string, command: string, checkout: string): string {
	const sandbox = join(dir, "sandbox");
	mkdirSync(sandbox);
	writeFileSync(join(sandbox, ovnfsTask.OVNFS_CHECKOUT_FILE), JSON.stringify({ command, checkout }));
	return sandbox;
}

/** A daemon serving one checkout `name` under `dir`, its executable, and a sandbox recording that checkout. */
async function ovnfsSetup(name: string): Promise<{ daemon: FakeDaemon; served: string; sandbox: string; verbs(): string[] }> {
	const dir = scratch();
	const socket = join(dir, "d.sock");
	const served = join(dir, "mnt", name);
	mkdirSync(served, { recursive: true });
	const daemon = await fakeDaemon(socket, [{ name: "omp-other-000000", path: join(dir, "mnt", "omp-other-000000") }, { name, path: served }]);
	const { command, verbs } = fakeCommand(dir, socket, join(dir, "mnt"));
	return { daemon, served, sandbox: ovnfsSandbox(dir, command, name), verbs };
}

describe("ovnfs record", () => {
	test("names the command and checkout omp recorded", () => {
		expect(parseOvnfsRecord(JSON.stringify({ command: "/usr/local/bin/ovnfs", checkout: "omp-task-a1b2c3", extra: 1 }))).toEqual({
			command: "/usr/local/bin/ovnfs",
			checkout: "omp-task-a1b2c3",
		});
	});

	test("names the baseline checkout omp records while one exists", () => {
		expect(parseOvnfsRecord(JSON.stringify({ command: "ovnfs", checkout: "omp-task-a1b2c3", start: "omp-task-a1b2c3-start" }))).toEqual({
			command: "ovnfs",
			checkout: "omp-task-a1b2c3",
			start: "omp-task-a1b2c3-start",
		});
		expect(() => parseOvnfsRecord(JSON.stringify({ command: "ovnfs", checkout: "omp-task-a1b2c3", start: "" }))).toThrow("names no ovnfs checkout");
	});

	test("throws for a record that is not JSON or names no checkout", () => {
		expect(() => parseOvnfsRecord("{")).toThrow();
		expect(() => parseOvnfsRecord(JSON.stringify({ command: "ovnfs" }))).toThrow("names no ovnfs checkout");
		expect(() => parseOvnfsRecord(JSON.stringify({ command: "ovnfs", checkout: " " }))).toThrow("names no ovnfs checkout");
		expect(() => parseOvnfsRecord(JSON.stringify(["ovnfs", "omp-task"]))).toThrow("names no ovnfs checkout");
	});
});

describe("ovnfs ls reply", () => {
	const reply = { checkouts: [{ name: "omp-a", path: "/mnt/omp-a", dirty: false }, { name: "omp-b", path: "/mnt/omp-b" }], snapshots: [] };

	test("gives the folder a listed checkout is served in, and null for one it does not list", () => {
		expect(servedPath(reply, "omp-b")).toBe("/mnt/omp-b");
		expect(servedPath(reply, "omp-c")).toBeNull();
		expect(servedPath({ checkouts: [] }, "omp-a")).toBeNull();
	});

	test("throws for a reply without a list of named, served checkouts", () => {
		expect(() => servedPath({ checkouts: null }, "omp-a")).toThrow("without a list of checkouts");
		expect(() => servedPath({}, "omp-a")).toThrow("without a list of checkouts");
		expect(() => servedPath(null, "omp-a")).toThrow("without a list of checkouts");
		expect(() => servedPath({ checkouts: [{ name: "omp-a", path: "/mnt/omp-a" }, { name: "omp-b" }] }, "omp-a")).toThrow("without a list of checkouts");
	});
});

describe("omp sandboxes over a running ovnfs daemon", () => {
	test("a sandbox without a record has no ovnfs checkout", async () => {
		expect(await ompSandboxes().ovnfsRecord(scratch())).toBeNull();
	});

	test("locates the recorded checkout on the running daemon and releases exactly it there", async () => {
		const { daemon, served, sandbox, verbs } = await ovnfsSetup("omp-task-a1b2c3");
		const sandboxes = ompSandboxes();
		const record = await sandboxes.ovnfsRecord(sandbox);
		expect(record).toMatchObject({ checkout: "omp-task-a1b2c3", served });
		await sandboxes.releaseOvnfs(record!);
		expect(daemon.removed).toEqual(["omp-task-a1b2c3"]);
		expect(existsSync(served)).toBe(false);
		expect(verbs()).toEqual(["status"]);
	});

	test("releases the baseline checkout the record names before the checkout itself", async () => {
		const { daemon, sandbox } = await ovnfsSetup("omp-task-a1b2c3");
		const file = join(sandbox, ovnfsTask.OVNFS_CHECKOUT_FILE);
		writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), start: "omp-other-000000" }));
		const sandboxes = ompSandboxes();
		await sandboxes.releaseOvnfs((await sandboxes.ovnfsRecord(sandbox))!);
		expect(daemon.removed).toEqual(["omp-other-000000", "omp-task-a1b2c3"]);
	});

	test("a checkout the daemon no longer lists is not served, and releasing one already gone counts as released", async () => {
		const { daemon, sandbox } = await ovnfsSetup("omp-task-a1b2c3");
		const sandboxes = ompSandboxes();
		const record = await sandboxes.ovnfsRecord(sandbox);
		writeFileSync(join(sandbox, ovnfsTask.OVNFS_CHECKOUT_FILE), JSON.stringify({ command: record!.command, checkout: "omp-task-gone00" }));
		expect(await sandboxes.ovnfsRecord(sandbox)).toMatchObject({ checkout: "omp-task-gone00", served: null });
		await sandboxes.releaseOvnfs({ ...record!, checkout: "omp-task-gone00" });
		expect(daemon.removed).toEqual([]);
	});

	test("a daemon that stops between judging and release is never started again", async () => {
		const { daemon, served, sandbox, verbs } = await ovnfsSetup("omp-task-a1b2c3");
		const sandboxes = ompSandboxes();
		const record = await sandboxes.ovnfsRecord(sandbox);
		await daemon.stop();
		await expect(sandboxes.releaseOvnfs(record!)).rejects.toThrow();
		await expect(sandboxes.ovnfsRecord(sandbox)).rejects.toThrow();
		expect(existsSync(served)).toBe(true);
		expect(verbs()).not.toContain("start");
	});

	test("a record whose command has no running daemon cannot be located", async () => {
		const dir = scratch();
		const { command, verbs } = fakeCommand(dir, join(dir, "absent.sock"), join(dir, "mnt"));
		await expect(ompSandboxes().ovnfsRecord(ovnfsSandbox(dir, command, "omp-task-a1b2c3"))).rejects.toThrow("no ovnfs daemon");
		expect(verbs()).toEqual(["status"]);
	});
});
