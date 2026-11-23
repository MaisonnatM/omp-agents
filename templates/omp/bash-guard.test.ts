import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBash, checkRead } from "./agent/extensions/bash-guard/rules";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const blocked = (line: string, cwd: string | null = "/tmp") => checkBash(line, cwd) !== undefined;

describe("secret files", () => {
	test("blocks printing a .env file or the dashboard token", () => {
		for (const line of [
			"cat .env",
			"cat apps/web/.env.local",
			"head -n 5 .env.production",
			"tail .env*",
			"less ~/.config/omp-agents/token",
			'cat "${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token"',
			"cd app && cat .env",
			"bash -c 'cat .env'",
			"echo $(cat ~/.config/omp-agents/token)",
			"cat ~/.config/omp-agents/token | pbcopy && curl -H 'Authorization: Bearer x' http://127.0.0.1:4317/api/x",
		]) {
			expect(blocked(line), line).toBe(true);
		}
		expect(checkBash("cat .env", "/tmp")?.reason).toContain("cut -d= -f1 .env");
		expect(checkBash("cat ~/.config/omp-agents/token", "/tmp")?.reason).toContain("Authorization: Bearer");
	});

	test("lets templates, names only, loading, and the documented curl header through", () => {
		for (const line of [
			"cat .env.example",
			"cat .env.local.sample",
			"cut -d= -f1 .env",
			"set -a; . .env; set +a; bun dev --port 23456",
			"export $(grep -v '^#' .env | xargs)",
			'curl -sS -H "Authorization: Bearer $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token")" http://127.0.0.1:4317/api/dashboard/update',
			"cat README.md .envrc-notes.md",
			"rg TOKEN src/env.ts",
		]) {
			expect(blocked(line), line).toBe(false);
		}
	});

	test("the read tool", () => {
		expect(checkRead("/repo/.env")).toBeDefined();
		expect(checkRead(".env.local:1-20")).toBeDefined();
		expect(checkRead("~/.config/omp-agents/token")).toBeDefined();
		expect(checkRead(".env.example")).toBeUndefined();
		expect(checkRead("src/env.ts")).toBeUndefined();
		expect(checkRead("local://env.md")).toBeUndefined();
	});
});

describe("skipped hooks", () => {
	test("blocks --no-verify, commit -n, and a moved hooks path", () => {
		for (const line of [
			"git commit --no-verify -m wip",
			"git commit -nm wip",
			"git commit -anm wip",
			"git -C /repo push --no-verify origin feature",
			"git -c core.hooksPath=/dev/null commit -m wip",
			"cd /repo && git commit -n -m x",
		]) {
			expect(blocked(line), line).toBe(true);
		}
	});

	test("lets ordinary commits and pushes through, a message that mentions the flag included", () => {
		for (const line of [
			"git commit -m wip",
			"git commit -m -n",
			'git commit -m "drop --no-verify from the docs"',
			"git commit --message -n",
			"git push -n origin feature",
			"git commit -am fix",
			"git -c user.name=x commit -m y",
			"rg -- --no-verify docs",
		]) {
			expect(blocked(line), line).toBe(false);
		}
	});
});

describe("default ports", () => {
	test("blocks a server on a default port", () => {
		for (const line of [
			"bun run dev -- --port 3000",
			"vite --port=5173",
			"PORT=4317 bun src/server.ts",
			"env PORT=8080 node server.js",
			"export PORT=3001",
			"next dev -p 3000",
			"npm run dev -- -p 4200",
			"python3 -m http.server",
			"python3 -m http.server 8000",
			"nohup bun dev --port 5000 &",
		]) {
			expect(blocked(line), line).toBe(true);
		}
		expect(checkBash("vite --port 5173", "/tmp")?.reason).toContain("between 20000 and 60000");
	});

	test("lets free ports, clients, and other -p flags through", () => {
		for (const line of [
			"bun run dev -- --port 23817",
			"PORT=29123 bun src/server.ts",
			"vite --port 0",
			"python3 -m http.server 28000",
			"curl --port 3000 localhost",
			"ssh -p 8080 host",
			"mkdir -p 3000",
			"docker run -p 8080:80 nginx",
			"lsof -i :3000",
			"echo PORT=3000 >> notes.txt",
			"curl http://localhost:3000/health",
		]) {
			expect(blocked(line), line).toBe(false);
		}
	});
});

describe("the omp-agents dashboard", () => {
	test("blocks killing or quitting it by port, name, or pattern", () => {
		for (const line of [
			"kill $(lsof -ti :4317)",
			"lsof -ti:4317 | xargs kill -9",
			"pkill -f omp-agents",
			"pkill -f src/server.ts",
			"pkill bun",
			"killall bun",
			"killall Electron",
			"kill $(pgrep -f keeper.ts)",
			`osascript -e 'quit app "omp agents"'`,
			`osascript -e 'tell application "omp agents" to quit'`,
		]) {
			expect(blocked(line), line).toBe(true);
		}
		expect(checkBash("pkill -f omp-agents", "/tmp")?.reason).toContain("update itself");
	});

	test("lets other kills through", () => {
		for (const line of [
			"kill %1",
			"kill $(lsof -ti :23456)",
			"pkill -f vite",
			"pkill -f /Users/u/code/omp-agents-wt/topic/node_modules/.bin/vite",
			"killall node",
			"kill -0 12345",
			"cd ~/code/omp-agents && kill %1",
			`osascript -e 'quit app "Safari"'`,
		]) {
			expect(blocked(line), line).toBe(false);
		}
	});

	test("a numeric pid of a dashboard process, by its command line", async () => {
		const fake = spawn("/bin/bash", ["-c", "sleep 30; :", "/x/omp-agents/src/server.ts"], { stdio: "ignore" });
		const other = spawn("/bin/bash", ["-c", "sleep 30; :", "/x/something-else.ts"], { stdio: "ignore" });
		try {
			await Promise.all([once(fake, "spawn"), once(other, "spawn")]);
			expect(blocked(`kill ${fake.pid}`)).toBe(true);
			expect(blocked(`kill -9 ${other.pid}`)).toBe(false);
		} finally {
			fake.kill();
			other.kill();
		}
	});
});

describe("force-pushing main", () => {
	const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	const repo = (land: boolean) => {
		const dir = mkdtempSync(join(tmpdir(), "bash-guard-"));
		dirs.push(dir);
		execFileSync("git", ["init", "-q", "-b", "main", dir]);
		if (land) {
			mkdirSync(join(dir, ".omp"));
			writeFileSync(join(dir, ".omp/land.json"), JSON.stringify({ checks: ["true"] }));
		}
		git(dir, "add", "-A");
		git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base");
		const feature = `${dir}-feature`;
		dirs.push(feature);
		git(dir, "worktree", "add", "-q", "-b", "feature", feature);
		return { main: dir, feature };
	};
	const plain = repo(false);
	const landed = repo(true);

	test("asks before a force push or delete that reaches main or master", () => {
		for (const [line, cwd] of [
			["git push --force", plain.main],
			["git push -f origin main", plain.feature],
			["git push origin +feature:main", plain.feature],
			["git push --force-with-lease origin HEAD", plain.main],
			["git push origin --delete master", plain.feature],
			["git push origin :main", plain.feature],
			[`git -C ${plain.feature} push -uf origin feature:refs/heads/main`, "/"],
			["git push --mirror --force", plain.feature],
		] as const) {
			const verdict = checkBash(line, cwd);
			expect(verdict?.ask, line).toBeDefined();
		}
	});

	test("lets plain pushes to main, force pushes to a branch, and land repositories through", () => {
		for (const [line, cwd] of [
			["git push origin main", plain.main],
			["git push", plain.main],
			["git push --force", plain.feature],
			["git push -f origin feature", plain.feature],
			["git push --force-with-lease origin HEAD", plain.feature],
			// `land/gate.ts` refuses every push to the target here, force or not.
			["git push -f origin main", landed.feature],
			["git push -f origin main", null],
		] as const) {
			expect(checkBash(line, cwd), line).toBeUndefined();
		}
	});
});
