import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planDevServer, startDevServer } from "./dev-server";

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: "app", scripts });
/** What `planDevServer` answers, as the command or the reason. */
const plan = (files: Record<string, string>, port = 20000): string => {
	const planned = planDevServer(files, port);
	return "command" in planned ? planned.command : planned.reason;
};

describe("planDevServer", () => {
	test("runs the dev script with the lockfile's package manager, passing --port to a server that takes it", () => {
		expect(plan({ "package.json": pkg({ dev: "vite", start: "node server.js" }), "bun.lock": "" }, 23456)).toBe("bun run dev --port 23456");
	});

	test("runs start when there is no dev script", () => {
		expect(plan({ "package.json": pkg({ start: "next dev", build: "next build" }), "pnpm-lock.yaml": "" }, 30000)).toBe("pnpm run start --port 30000");
	});

	test("names the package manager by its lockfile, npm when there is none, and puts npm's arguments after --", () => {
		const commands = ["bun.lockb", "pnpm-lock.yaml", "yarn.lock", null, "package-lock.json"].map(lockfile =>
			plan({ "package.json": pkg({ dev: "astro dev" }), ...(lockfile ? { [lockfile]: "" } : {}) }, 21000),
		);
		expect(commands).toEqual(["bun run dev --port 21000", "pnpm run dev --port 21000", "yarn run dev --port 21000", "npm run dev -- --port 21000", "npm run dev -- --port 21000"]);
	});

	test("passes --port only to the dev servers that take it, by the script's last command, and sets PORT for the rest", () => {
		const flagged = (script: string): boolean => plan({ "package.json": pkg({ dev: script }) }).endsWith("--port 20000");
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
		expect(plan({ "package.json": pkg({ dev: "node server.js" }), "yarn.lock": "" })).toBe("yarn run dev");
	});

	test("says why there is nothing to run", () => {
		expect(plan({ "bun.lock": "" })).toBe("no package.json");
		expect(plan({ "package.json": pkg({ build: "vite build", test: "vitest" }) })).toBe("no dev or start script in package.json");
		expect(plan({ "package.json": JSON.stringify({ name: "lib" }) })).toBe("no dev or start script in package.json");
		expect(plan({ "package.json": "{ not json" })).toBe("package.json is not valid JSON");
	});

	test("leaves to the session a script that pins its port or runs several servers, and an app pointed at another local server", () => {
		const reason = (script: string, envFiles: Record<string, string> = {}): string => plan({ "package.json": pkg({ dev: script }), ...envFiles });
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
			"npm run dev -- --port 20000",
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
		const starts: unknown[] = [];
		const running = await startDevServer("session-1", dir, async (at, owner, service) => {
			starts.push({ at, owner, ...service });
			return { running: true };
		});
		if (!("started" in running)) throw new Error(running.fallback);
		const { port } = running.started;
		expect(running).toEqual({ started: { port, command: `bun run dev --port ${port}` } });
		expect(starts).toEqual([{ at: dir, owner: "session-1", name: `dev-${port}`, command: `bun run dev --port ${port}`, env: { PORT: String(port) }, readyPort: port }]);
		expect(port >= 20_000 && port <= 39_999).toBe(true);

		const ended = await startDevServer("session-1", dir, async () => ({ ended: "error: missing DATABASE_URL" }));
		expect("fallback" in ended && ended.fallback.replace(/\d+/, "N")).toBe("bun run dev --port N exited: error: missing DATABASE_URL");
		const refused = await startDevServer("session-1", dir, async () => {
			throw new Error("broker refused the start");
		});
		expect(refused).toEqual({ fallback: "broker refused the start" });
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
