import { describe, expect, test } from "bun:test";
import { planDevServer } from "./dev-server";

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: "app", scripts });

describe("planDevServer", () => {
	test("runs the dev script with the lockfile's package manager, passing --port to a server that takes it", () => {
		expect(planDevServer(pkg({ dev: "vite", start: "node server.js" }), ["bun.lock"], 23456)).toEqual({
			ok: { script: "dev", command: "bun run dev --port 23456", env: { PORT: "23456" }, port: 23456, portFlag: true },
		});
	});

	test("runs start when there is no dev script", () => {
		expect(planDevServer(pkg({ start: "next dev", build: "next build" }), ["pnpm-lock.yaml"], 30000)).toEqual({
			ok: { script: "start", command: "pnpm run start --port 30000", env: { PORT: "30000" }, port: 30000, portFlag: true },
		});
	});

	test("names the package manager by its lockfile, npm when there is none, and puts npm's arguments after --", () => {
		const commands = [["bun.lockb"], ["pnpm-lock.yaml"], ["yarn.lock"], [], ["package-lock.json"]].map(lockfiles => {
			const planned = planDevServer(pkg({ dev: "astro dev" }), lockfiles, 21000);
			return "ok" in planned ? planned.ok.command : planned.reason;
		});
		expect(commands).toEqual(["bun run dev --port 21000", "pnpm run dev --port 21000", "yarn run dev --port 21000", "npm run dev -- --port 21000", "npm run dev -- --port 21000"]);
	});

	test("passes --port only to the dev servers that take it, by the script's last command, and sets PORT for the rest", () => {
		const flagged = (script: string): boolean | string => {
			const planned = planDevServer(pkg({ dev: script }), [], 25000);
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
				"concurrently \"vite\" \"node api.js\"",
			].map(flagged),
		).toEqual([true, true, false, true, true, true, true, true, true, true, true, false, false, false]);
		expect(planDevServer(pkg({ dev: "node server.js" }), ["yarn.lock"], 25000)).toEqual({
			ok: { script: "dev", command: "yarn run dev", env: { PORT: "25000" }, port: 25000, portFlag: false },
		});
	});

	test("says why there is nothing to run", () => {
		expect(planDevServer(null, ["bun.lock"], 20000)).toEqual({ reason: "no package.json" });
		expect(planDevServer(pkg({ build: "vite build", test: "vitest" }), [], 20000)).toEqual({ reason: "no dev or start script in package.json" });
		expect(planDevServer(JSON.stringify({ name: "lib" }), [], 20000)).toEqual({ reason: "no dev or start script in package.json" });
		expect(planDevServer("{ not json", [], 20000)).toEqual({ reason: "package.json is not valid JSON" });
	});
});
