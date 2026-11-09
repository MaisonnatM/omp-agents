/** Package managers' caches for Settings › Storage: each tool's own prune, keeping the uv entries a running process uses. */
import { link, lstat, mkdir, readdir, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { errorText } from "../json";
import { openPathsIn } from "../process-census";
import { run } from "../proc";
import { CleanupBusy, PACKAGE_TOOLS, type CachePlan, type CacheResult, type PackageTool } from "../shared/storage";
import { allocatedUsage } from "../worktrees";

const MEASURE_MS = 2 * 60_000;
const PRUNE_MS = 30 * 60_000;

/**
 * uv's `--force` skips its cache lock: every running `uvx` process, such as an MCP server a session starts, holds that lock
 * for its whole life, so without it the prune waits for as long as any session runs.
 */
const TOOLS: Record<PackageTool, { dir: string[]; prune: string[] }> = {
	uv: { dir: ["uv", "cache", "dir"], prune: ["uv", "cache", "prune", "--force"] },
	pnpm: { dir: ["pnpm", "store", "path"], prune: ["pnpm", "store", "prune"] },
	bun: { dir: ["bun", "pm", "cache"], prune: ["bun", "pm", "cache", "rm"] },
};

async function cacheDir(tool: PackageTool): Promise<string | null> {
	if (!Bun.which(tool)) return null;
	const { code, stdout } = await run(TOOLS[tool].dir, { cwd: homedir(), child: true, timeoutMs: 30_000 });
	const path = stdout.trim().split("\n").at(-1)?.trim();
	return code === 0 && path ? path : null;
}

async function measured(path: string): Promise<number | null> {
	try { return await allocatedUsage(path, { timeoutMs: MEASURE_MS }); } catch { return null; }
}

export async function previewCaches(): Promise<CachePlan[]> {
	const plans = await Promise.all(PACKAGE_TOOLS.map(async tool => {
		const path = await cacheDir(tool);
		return path === null ? null : { tool, path, bytes: await measured(path) };
	}));
	return plans.filter(plan => plan !== null);
}

/**
 * The cache's second-level entries, such as `archive-v0/<id>`, that a running process has open; `uvx` runs tools straight from them.
 * `lsof` exits 1 whenever some process was unreadable, so only empty output or another exit, such as the timeout's kill, means it could not tell.
 */
async function openEntries(cache: string): Promise<string[]> {
	const root = await realpath(cache);
	const listed = await openCachePaths(root);
	const prefix = `${root}/`;
	const entries = new Set<string>();
	for (const path of listed) {
		if (!path.startsWith(prefix)) continue;
		const [bucket, entry] = path.slice(prefix.length).split("/");
		if (bucket && entry) entries.add(join(root, bucket, entry));
	}
	return [...entries];
}

async function openCachePaths(root: string): Promise<string[]> {
	try {
		const { code, stdout } = await run(["lsof", "-nP", "-w", "-Fn"], { timeoutMs: 60_000 });
		if (code <= 1 && stdout) return stdout.split("\n").filter(line => line.startsWith("n")).map(line => line.slice(1));
	} catch {
		// `lsof` is not installed.
	}
	if (process.platform === "linux") return openPathsIn("/proc").filter(path => path.startsWith(`${root}/`));
	throw new Error("Cannot list the files running tools have open, so uv's cache was not pruned.");
}

async function linkTree(source: string, target: string): Promise<void> {
	const info = await lstat(source);
	if (info.isDirectory()) {
		await mkdir(target);
		for (const name of await readdir(source)) await linkTree(join(source, name), join(target, name));
	} else if (info.isSymbolicLink()) await symlink(await readlink(source), target);
	else await link(source, target);
}

async function missing(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
}

/** Moves back every file of `copy` that is gone from `original`, so an entry the prune removed whole or in part is complete again. */
async function restoreTree(copy: string, original: string): Promise<void> {
	if ((await lstat(copy)).isDirectory()) {
		await mkdir(original, { recursive: true });
		for (const name of await readdir(copy)) await restoreTree(join(copy, name), join(original, name));
	} else if (await missing(original)) await rename(copy, original);
}

/**
 * Runs `prune` with `entries` hard-linked into `keep` first, then puts back whatever it removed from them, since a cache prune
 * counts an entry a running process uses as unused. `keep` must sit on the cache's volume.
 */
export async function pruneKeeping(entries: readonly string[], keep: string, prune: () => Promise<void>): Promise<void> {
	await rm(keep, { recursive: true, force: true });
	await mkdir(keep, { recursive: true });
	try {
		const saved: { entry: string; copy: string }[] = [];
		for (const [index, entry] of entries.entries()) {
			const copy = join(keep, String(index));
			await linkTree(entry, copy);
			saved.push({ entry, copy });
		}
		try { await prune(); } finally {
			for (const { entry, copy } of saved) await restoreTree(copy, entry);
		}
	} finally {
		await rm(keep, { recursive: true, force: true });
	}
}

function pruneError(plan: CachePlan, stderr: string): string {
	const text = stderr.trim().split("\n").filter(Boolean).at(-1) ?? `${plan.tool} stopped with an error.`;
	return /permission denied/i.test(stderr)
		? `${text} Some files belong to another user, often after a sudo install. Run sudo chown -R "$USER" "${plan.path}", then clean up again.`
		: text;
}

async function cleanCache(plan: CachePlan): Promise<CacheResult> {
	const prune = async (): Promise<void> => {
		const { code, stderr } = await run(TOOLS[plan.tool].prune, { cwd: homedir(), child: true, timeoutMs: PRUNE_MS });
		if (code !== 0) throw new Error(pruneError(plan, stderr));
	};
	try {
		if (plan.tool === "uv") await pruneKeeping(await openEntries(plan.path), join(dirname(plan.path), ".uv-cache-keep"), prune);
		else await prune();
		return { ...plan, after: await measured(plan.path), error: null };
	} catch (error) {
		return { ...plan, after: null, error: errorText(error) };
	}
}

let cleaning = false;
/** Prunes every installed tool's cache in turn, measuring each before and after. */
export async function cleanCaches(): Promise<CacheResult[]> {
	if (cleaning) throw new CleanupBusy();
	cleaning = true;
	try {
		const results: CacheResult[] = [];
		for (const plan of await previewCaches()) results.push(await cleanCache(plan));
		return results;
	} finally {
		cleaning = false;
	}
}
