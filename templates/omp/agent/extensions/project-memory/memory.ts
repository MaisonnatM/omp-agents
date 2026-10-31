import { spawnSync } from "node:child_process";
import type { Sha } from "./repo";

export const MEMORY_REF = "refs/omp/memory";
export const MEMORY_KINDS = ["decision", "fact", "lesson"] as const;
export const LINE_MAX = 120;
export const BODY_MAX = 2000;
export const MEMORY_LIMIT = 150;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const RACE_TRIES = 20;
// A fixed identity, so a repository without `user.name` can still record memory.
const IDENTITY = {
	GIT_AUTHOR_NAME: "omp project memory",
	GIT_AUTHOR_EMAIL: "project-memory@omp.invalid",
	GIT_COMMITTER_NAME: "omp project memory",
	GIT_COMMITTER_EMAIL: "project-memory@omp.invalid",
};

export type MemoryKind = (typeof MEMORY_KINDS)[number];
/** A memory's key, `^[a-z0-9][a-z0-9-]{0,47}$`; only `parseOps` and `parseDoc` make one. */
export type Slug = string & { readonly __slug: unique symbol };

export interface Memory {
	kind: MemoryKind;
	line: string;
	body: string;
	/** `#<session id>` of the session that last added or updated it. */
	source: string;
	/** `YYYY-MM-DD` of that change. */
	updated: string;
}

export interface MemoryDoc {
	memories: Record<Slug, Memory>;
}

/** One op as the `project_memory` tool's flat schema takes it. */
export interface RawOp {
	op: "add" | "update" | "delete";
	slug: string;
	kind?: MemoryKind;
	line?: string;
	body?: string;
}

export type MemoryOp =
	| { op: "add"; slug: Slug; kind: MemoryKind; line: string; body: string }
	| { op: "update"; slug: Slug; kind?: MemoryKind; line?: string; body?: string }
	| { op: "delete"; slug: Slug };

/** A batch against one doc: the doc it leaves and its summary, or every reason it is refused. Never partial. */
export type Plan = { ok: true; doc: MemoryDoc; summary: string } | { ok: false; reasons: string[] };

/** A memory another session changed since a session last looked; added and updated carry the memory as it is now. */
export type MemoryChange = { change: "added" | "updated"; slug: Slug; memory: Memory } | { change: "deleted"; slug: Slug };

const EMPTY: MemoryDoc = { memories: {} };

const isSlug = (value: unknown): value is Slug => typeof value === "string" && SLUG.test(value);
const isKind = (value: unknown): value is MemoryKind => MEMORY_KINDS.includes(value as MemoryKind);

/** The tool's ops as domain ops, or every op that is malformed and why. */
export function parseOps(raw: readonly RawOp[]): { ok: true; ops: MemoryOp[] } | { ok: false; reasons: string[] } {
	if (raw.length === 0) return { ok: false, reasons: ["ops is empty; pass at least one op."] };
	const ops: MemoryOp[] = [];
	const reasons: string[] = [];
	for (const { op, slug, kind, line, body } of raw) {
		const problems: string[] = [];
		if (!isSlug(slug)) problems.push("a slug is 1 to 48 lowercase letters, digits, and hyphens, starting with a letter or digit");
		if (op === "add") {
			const missing = (["kind", "line", "body"] as const).filter(field => ({ kind, line, body })[field] === undefined);
			if (missing.length > 0) problems.push(`add needs ${missing.join(", ")}`);
		}
		if (op === "delete" && (kind !== undefined || line !== undefined || body !== undefined)) problems.push("delete takes only a slug");
		if (problems.length > 0) {
			reasons.push(`${op} ${slug}: ${problems.join("; ")}.`);
			continue;
		}
		const parsed = slug as Slug;
		if (op === "add") ops.push({ op, slug: parsed, kind: kind as MemoryKind, line: line as string, body: body as string });
		else if (op === "update") ops.push({ op, slug: parsed, kind, line, body });
		else ops.push({ op, slug: parsed });
	}
	return reasons.length > 0 ? { ok: false, reasons } : { ok: true, ops };
}

function fieldProblems(op: { line?: string; body?: string }): string[] {
	const problems: string[] = [];
	if (op.line !== undefined) {
		if (op.line.trim() === "") problems.push("line is empty");
		else if (/[\r\n]/.test(op.line)) problems.push("line must be one line");
		else if (op.line.length > LINE_MAX) problems.push(`line is ${op.line.length} characters; the limit is ${LINE_MAX}`);
	}
	if (op.body !== undefined && op.body.length > BODY_MAX) problems.push(`body is ${op.body.length} characters; the limit is ${BODY_MAX}`);
	return problems;
}

/**
 * Checks `ops` in order against `doc` as the batch leaves it, so an op sees the ones before it, and collects every reason
 * to refuse. Pure; `source` and `today` stamp each add and update.
 */
export function planOps(doc: MemoryDoc, ops: readonly MemoryOp[], source: string, today: string): Plan {
	const memories: Record<Slug, Memory> = { ...doc.memories };
	const reasons: string[] = [];
	const done: string[] = [];
	for (const op of ops) {
		const current = memories[op.slug];
		const problems: string[] = [];
		switch (op.op) {
			case "add":
				problems.push(...fieldProblems(op));
				if (current) problems.push("the slug exists; use update");
				else memories[op.slug] = { kind: op.kind, line: op.line, body: op.body, source, updated: today };
				break;
			case "update":
				problems.push(...fieldProblems(op));
				if (op.kind === undefined && op.line === undefined && op.body === undefined) problems.push("give at least one of kind, line, and body");
				if (!current) problems.push("no memory has this slug; use add");
				else memories[op.slug] = { kind: op.kind ?? current.kind, line: op.line ?? current.line, body: op.body ?? current.body, source, updated: today };
				break;
			case "delete":
				if (!current) problems.push("no memory has this slug");
				else delete memories[op.slug];
				break;
			default: {
				const unknown: never = op;
				throw new Error(`Unknown memory op ${JSON.stringify(unknown)}`);
			}
		}
		if (problems.length > 0) reasons.push(`${op.op} ${op.slug}: ${problems.join("; ")}.`);
		else done.push(`${{ add: "added", update: "updated", delete: "deleted" }[op.op]} ${op.slug}`);
	}
	const count = Object.keys(memories).length;
	if (count > MEMORY_LIMIT) reasons.push(`The batch would leave ${count} memories; the limit is ${MEMORY_LIMIT}.`);
	if (reasons.length > 0) return { ok: false, reasons };
	const summary = done.join(", ");
	return { ok: true, doc: { memories }, summary: summary.charAt(0).toUpperCase() + summary.slice(1) };
}

/** `memory.json` as a doc; anything else throws, so a damaged doc is never read as an empty one. */
export function parseDoc(text: string): MemoryDoc {
	const raw: unknown = JSON.parse(text);
	const entries = typeof raw === "object" && raw !== null && "memories" in raw ? raw.memories : undefined;
	if (typeof entries !== "object" || entries === null) throw new Error("memory.json has no memories object");
	const memories: Record<Slug, Memory> = {};
	for (const [slug, value] of Object.entries(entries)) {
		const { kind, line, body, source, updated }: Partial<Record<keyof Memory, unknown>> = value ?? {};
		if (!isSlug(slug) || !isKind(kind) || typeof line !== "string" || typeof body !== "string" || typeof source !== "string" || typeof updated !== "string") {
			throw new Error(`memory.json holds a malformed memory ${JSON.stringify(slug)}`);
		}
		memories[slug] = { kind, line, body, source, updated };
	}
	return { memories };
}

function sortedJson(doc: MemoryDoc): string {
	const sorted = (_key: string, value: unknown) =>
		typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value;
	return `${JSON.stringify(doc, sorted, 2)}\n`;
}

function run(commonDir: string, args: string[], input?: string, env?: Record<string, string>) {
	return spawnSync("git", ["--git-dir", commonDir, ...args], { input, env: env && { ...process.env, ...env } });
}

function git(commonDir: string, args: string[], input?: string, env?: Record<string, string>): string {
	const result = run(commonDir, args, input, env);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.toString().trim() || result.error?.message}`);
	return result.stdout.toString().trim();
}

function commitOf(commonDir: string, rev: string): Sha | null {
	const result = run(commonDir, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
	if (result.status === 1) return null;
	if (result.status !== 0) throw new Error(`git rev-parse ${rev} failed: ${result.stderr?.toString().trim() || result.error?.message}`);
	return result.stdout.toString().trim() as Sha;
}

/** The commit MEMORY_REF points to, `null` before the first write. */
export const memoryTip = (commonDir: string): Sha | null => commitOf(commonDir, MEMORY_REF);

/** The doc at `commit`, or the empty doc for `null`. */
export function readMemory(commonDir: string, commit: Sha | null): MemoryDoc {
	return commit ? parseDoc(git(commonDir, ["cat-file", "blob", `${commit}:memory.json`])) : EMPTY;
}

function readDocs(commonDir: string, commits: readonly Sha[]): Map<Sha, MemoryDoc> {
	const result = run(commonDir, ["cat-file", "--batch"], commits.map(commit => `${commit}:memory.json\n`).join(""));
	if (result.status !== 0) throw new Error(`git cat-file --batch failed: ${result.stderr.toString().trim()}`);
	const out: Buffer = result.stdout;
	const docs = new Map<Sha, MemoryDoc>();
	let at = 0;
	for (const commit of commits) {
		const end = out.indexOf(10, at);
		const header = out.toString("utf8", at, end).split(" ");
		if (header[1] !== "blob") throw new Error(`${commit} on ${MEMORY_REF} holds no memory.json`);
		const size = Number(header[2]);
		docs.set(commit, parseDoc(out.toString("utf8", end + 1, end + 1 + size)));
		at = end + 1 + size + 1;
	}
	return docs;
}

/**
 * Applies one batch to MEMORY_REF, all or nothing, against whatever the ref holds when it lands: a writer that moved the
 * ref first makes the swap fail, and the batch is planned again on its result, up to RACE_TRIES times.
 */
export function applyMemoryOps(commonDir: string, session: string, ops: readonly MemoryOp[], today: string): Plan {
	let lost = "";
	for (let attempt = 0; attempt < RACE_TRIES; attempt++) {
		const old = memoryTip(commonDir);
		const plan = planOps(readMemory(commonDir, old), ops, `#${session}`, today);
		if (!plan.ok) return plan;
		const blob = git(commonDir, ["hash-object", "-w", "--stdin"], sortedJson(plan.doc));
		const tree = git(commonDir, ["mktree"], `100644 blob ${blob}\tmemory.json\n`);
		const commit = git(commonDir, ["commit-tree", "--no-gpg-sign", tree, ...(old ? ["-p", old] : []), "-m", plan.summary, "-m", `Omp-Session: ${session}`], undefined, IDENTITY);
		const swap = run(commonDir, ["update-ref", "--stdin"], old ? `update ${MEMORY_REF} ${commit} ${old}\n` : `create ${MEMORY_REF} ${commit}\n`);
		if (swap.status === 0) return plan;
		lost = swap.stderr.toString().trim();
	}
	throw new Error(`Other sessions kept changing memory during ${RACE_TRIES} tries (${lost}); call again.`);
}

/**
 * What commits of MEMORY_REF after `from` up to `to` changed, leaving out those whose `Omp-Session` trailer is `session`:
 * each slug such a commit touched, compared between `from` and `to`. A `from` git no longer knows counts as the start.
 */
export function memoryChanges(commonDir: string, from: Sha | null, to: Sha, session: string): MemoryChange[] {
	const since = from && commitOf(commonDir, from);
	const log = git(commonDir, ["log", "--format=%H%x1f%P%x1f%(trailers:key=Omp-Session,valueonly,separator=%x2c)", since ? `${since}..${to}` : to]);
	const foreign = log
		.split("\n")
		.filter(Boolean)
		.map(line => line.split("\x1f"))
		.filter(([, , trailers]) => !(trailers ?? "").split(",").includes(session))
		.map(([sha, parents]) => ({ sha: sha as Sha, parent: ((parents ?? "").split(" ")[0] || null) as Sha | null }));
	if (foreign.length === 0) return [];
	const wanted = new Set<Sha>([to, ...(since ? [since] : []), ...foreign.flatMap(({ sha, parent }) => (parent ? [sha, parent] : [sha]))]);
	const docs = readDocs(commonDir, [...wanted]);
	const doc = (commit: Sha | null) => (commit ? (docs.get(commit) as MemoryDoc) : EMPTY);
	const touched = new Set<Slug>();
	for (const { sha, parent } of foreign) {
		const before = doc(parent).memories;
		const after = doc(sha).memories;
		for (const slug of new Set([...Object.keys(before), ...Object.keys(after)] as Slug[])) {
			if (JSON.stringify(before[slug]) !== JSON.stringify(after[slug])) touched.add(slug);
		}
	}
	const before = doc(since || null).memories;
	const after = doc(to).memories;
	const changes: MemoryChange[] = [];
	for (const slug of [...touched].sort()) {
		const was = before[slug];
		const now = after[slug];
		if (now && !was) changes.push({ change: "added", slug, memory: now });
		else if (now && was && JSON.stringify(now) !== JSON.stringify(was)) changes.push({ change: "updated", slug, memory: now });
		else if (was && !now) changes.push({ change: "deleted", slug });
	}
	const order = { added: 0, updated: 1, deleted: 2 };
	return changes.sort((a, b) => order[a.change] - order[b.change]);
}

/** `slug [kind] — line (updated YYYY-MM-DD)` per memory, newest update first; `""` for none. */
export function indexText(doc: MemoryDoc): string {
	return (Object.entries(doc.memories) as [Slug, Memory][])
		.sort(([a, x], [b, y]) => (x.updated === y.updated ? (a < b ? -1 : 1) : x.updated < y.updated ? 1 : -1))
		.map(([slug, memory]) => `${slug} [${memory.kind}] — ${memory.line} (updated ${memory.updated})`)
		.join("\n");
}
