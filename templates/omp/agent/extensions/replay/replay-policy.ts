import { realpathSync, existsSync, statSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";

export type Inspector = (mode: string, input: string) => { paths: string[]; fileOps: { kind: string; path: string; to?: string }[] };
export interface GuardPolicy { worktree: string; originalRoots: string[] }
const protectedPath = (path: string) => /(?:^|\/)(?:\.git|\.omp|\.pi|\.agents)(?:\/|$)/.test(path);
function realTarget(path: string, depth = 0): string {
	if (depth > 64) throw new Error("Too many symlinks while checking the write target.");
	try {
		if (lstatSync(path).isSymbolicLink()) return realTarget(resolve(dirname(path), readlinkSync(path)), depth + 1);
		return realpathSync(path);
	} catch (error) {
		if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
		const parent = dirname(path);
		return parent === path ? path : join(realTarget(parent, depth + 1), relative(parent, path));
	}
}
export function judgeReplayTool(toolName: string, input: Record<string, unknown>, cwd: string, policy: GuardPolicy, inspect?: Inspector): string | null {
	if (toolName === "read" || toolName === "grep" || toolName === "glob") {
		const path = typeof input.path === "string" ? input.path : "";
		const device = path.split(";").some(target => {
			const colon = target.indexOf(":");
			return colon >= 0 && !/^(?:(?:raw|img):)?[\d,+hms:-]+(?::raw|:img)?$|^(?:raw|img|conflicts)$/.test(target.slice(colon + 1));
		});
		return device || path.includes("?") ? "URI devices and query-bearing reads are blocked in a replay; use local file paths." : null;
	}
	if (toolName === "bash") return null;
	if (toolName !== "write" && toolName !== "edit") return `${toolName} is blocked in a replay. Eval, task, LSP, MCP, and unknown tools cannot run.`;
	const paths: string[] = [];
	if (toolName === "write" && typeof input.path === "string") paths.push(input.path);
	if (toolName === "edit" && inspect) {
		for (const mode of ["hashline", "replace", "patch", "apply_patch", "sloppy"]) {
			try {
				const inspected = inspect(mode, JSON.stringify(input));
				paths.push(...inspected.paths, ...inspected.fileOps.flatMap(op => op.to ? [op.path, op.to] : [op.path]));
			} catch {}
		}
	}
	if (!paths.length) return "The replay guard could not establish every write target.";
	for (const target of paths) {
		if (target.includes(":") || target.includes("?")) return "URI, archive, and database writes are blocked in a replay.";
		const lexical = resolve(cwd, target.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
		const path = realTarget(lexical);
		if (protectedPath(lexical) || protectedPath(path)) return "Git metadata and runtime configuration writes are blocked in a replay.";
		if (existsSync(lexical) && statSync(lexical).nlink > 1) return "Hard-linked write targets are blocked in a replay.";
		const within = relative(realTarget(policy.worktree), path);
		if (within !== ".." && !within.startsWith("../") && !isAbsolute(within)) continue;
		const original = policy.originalRoots.map(root => realTarget(root)).find(root => path === root || path.startsWith(`${root}/`));
		return `Writes outside ${policy.worktree} are blocked.${original ? ` Use ${join(policy.worktree, relative(original, path))} instead.` : ` Target: ${path}.`}`;
	}
	return null;
}
