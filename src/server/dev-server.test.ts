import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planDevServer, startDevServer } from "./dev-server";

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: "app", scripts });

describe("planDevServer", () => {
	test("runs the dev script with the lockfile's package manager, passing --port to a server that takes it", () => {
		expect(planDevServer(pkg({ dev: "vite", start: "node server.js" }), ["bun.lock"], {}, 23456)).toEqual({
			ok: { script: "dev", command: "bun run dev --port 23456", env: { PORT: "23456" }, port: 23456, portFlag: true },
		});
	});

	test("runs start when there is no dev script", () => {
		expect(planDevServer(pkg({ start: "next dev", build: "next build" }), ["pnpm-lock.yaml"], {}, 30000)).toEqual({
			ok: { script: "start", command: "pnpm run start --port 30000", env: { PORT: "30000" }, port: 30000, portFlag: true },
		});
	});

	test("names the package manager by its lockfile, npm when there is none, and puts npm's arguments after --", () => {
		const commands = [["bun.lockb"], ["pnpm-lock.yaml"], ["yarn.lock"], [], ["package-lock.json"]].map(lockfiles => {
			const planned = planDevServer(pkg({ dev: "astro dev" }), lockfiles, {}, 21000);
			return "ok" in planned ? planned.ok.command : planned.reason;
		});
		expect(commands).toEqual(["bun run dev --port 21000", "pnpm run dev --port 21000", "yarn run dev --port 21000", "npm run dev -- --port 21000", "npm run dev -- --port 21000"]);
	});

	test("passes --port only to the dev servers that take it, by the script's last command, and sets PORT for the rest", () => {
		const flagged = (script: string): boolean | string => {
			const planned = planDevServer(pkg({ dev: script }), [], {}, 25000);
			return "ok" in planned ? planned.ok.portFlag : planned.reason;
		};
		expect(
			[
				"vite",
				"vite --host",
				"vite build",
				"NODE_ENV=development vite dev",
				"cross-env FOO=1 npx nuxi dev",
				"nuxt dev",
				"svelte-kit dev",
				"webpack serve --mode development",
				"webpack-dev-server",
				"remix vite:dev",
				"tsc -b && next dev --turbo",
				"node server.js",
				"next dev && echo done",
				"vite --host 2>&1",
			].map(flagged),
		).toEqual([true, true, false, true, true, true, true, true, true, true, true, false, false, true]);
		expect(planDevServer(pkg({ dev: "node server.js" }), ["yarn.lock"], {}, 25000)).toEqual({
			ok: { script: "dev", command: "yarn run dev", env: { PORT: "25000" }, port: 25000, portFlag: false },
		});
	});

	test("says why there is nothing to run", () => {
		expect(planDevServer(null, ["bun.lock"], {}, 20000)).toEqual({ reason: "no package.json" });
		expect(planDevServer(pkg({ build: "vite build", test: "vitest" }), [], {}, 20000)).toEqual({ reason: "no dev or start script in package.json" });
		expect(planDevServer(JSON.stringify({ name: "lib" }), [], {}, 20000)).toEqual({ reason: "no dev or start script in package.json" });
		expect(planDevServer("{ not json", [], {}, 20000)).toEqual({ reason: "package.json is not valid JSON" });
	});

	test("leaves to the session a script that pins its port or runs several servers, and an app pointed at another local server", () => {
		const reason = (script: string, envFiles: Record<string, string> = {}): string => {
			const planned = planDevServer(pkg({ dev: script }), [], envFiles, 20000);
			return "reason" in planned ? planned.reason : "planned";
		};
		expect([
			reason("NODE_OPTIONS='--import ./x.mjs' react-router dev --port 3000"),
			reason("next dev -p 3001"),
			reason("PORT=4000 node server.js"),
			reason("concurrently \"vite\" \"node api.js\""),
			reason("node api.js & vite"),
			reason("turbo run dev"),
			reason("react-router dev", { ".env": "# api\nPUBLIC_API_URL=http://localhost:8000\n" }),
			reason("vite", { ".env.local": "export VITE_API='http://127.0.0.1:9000/v1'" }),
			reason("vite", { ".env": "SENTRY_DSN=https://key@sentry.io/1\nAPP_NAME=x" }),
		]).toEqual([
			"the dev script pins port 3000",
			"the dev script pins port 3001",
			"the dev script pins port 4000",
			"the dev script runs several servers",
			"the dev script runs several servers",
			"the dev script runs several servers",
			".env points PUBLIC_API_URL at http://localhost:8000, a server this start would not run",
			".env.local points VITE_API at http://127.0.0.1:9000, a server this start would not run",
			"planned",
		]);
	});
});

describe("startDevServer", () => {
	const project = async (files: Record<string, string>): Promise<string> => {
		const dir = await mkdtemp(join(tmpdir(), "dev-server-"));
		await Promise.all(Object.entries(files).map(([name, text]) => Bun.write(join(dir, name), text)));
		return dir;
	};

	test("starts the planned command as the session's service on the picked port, and answers why when it ended", async () => {
		const dir = await project({ "package.json": pkg({ dev: "vite" }), "bun.lock": "" });
		const specs: { owner: string; name: string; args: string[]; port: number | undefined }[] = [];
		const running = await startDevServer("session-1", dir, async (_dir, owner, spec) => {
			specs.push({ owner, name: spec.name, args: spec.args, port: spec.ready?.port });
			return { running: true };
		});
		if (!("started" in running)) throw new Error(running.fallback);
		const { port } = running.started;
		expect(running).toEqual({ started: { port, command: `bun run dev --port ${port}` } });
		expect(specs).toEqual([{ owner: "session-1", name: `dev-${port}`, args: ["-lc", `bun run dev --port ${port}`], port }]);
		expect(port >= 20_000 && port <= 39_999).toBe(true);

		const ended = await startDevServer("session-1", dir, async () => ({ ended: "error: missing DATABASE_URL" }));
		expect("fallback" in ended && ended.fallback.replace(/\d+/, "N")).toBe("bun run dev --port N exited: error: missing DATABASE_URL");
	});

	test("starts nothing when the plan leaves it to the session", async () => {
		const dir = await project({ "package.json": pkg({ dev: "react-router dev" }), ".env": "PUBLIC_API_URL=http://localhost:8000\n" });
		let started = false;
		const answer = await startDevServer("session-1", dir, async () => {
			started = true;
			return { running: true };
		});
		expect(answer).toEqual({ fallback: ".env points PUBLIC_API_URL at http://localhost:8000, a server this start would not run" });
		expect(started).toBe(false);
	});
});
