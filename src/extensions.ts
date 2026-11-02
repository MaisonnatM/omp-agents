import { errorText, isNonEmpty, isObject } from "./json";
import { changeExtensions, loadExtensions } from "./omp/extensions";
import { Rejected } from "./settings";
import type { ExtensionChange, ExtensionOperation } from "./shared/extensions";

export function parseExtensionChange(raw: unknown): ExtensionChange {
	if (!isObject(raw)) throw new Rejected(400, "Expected an extension change");
	const { kind } = raw;
	if (kind === "install" && ["marketplace", "plugin", "registry-skill"].includes(String(raw.packageKind)) && isNonEmpty(raw.spec) && typeof raw.source === "string" && (raw.scope === "user" || raw.scope === "project")) return { kind, packageKind: raw.packageKind as "marketplace" | "plugin" | "registry-skill", spec: raw.spec.trim(), source: raw.source, scope: raw.scope };
	if ((kind === "update" || kind === "uninstall") && isNonEmpty(raw.key)) return { kind, key: raw.key };
	if (kind === "enabled" && isNonEmpty(raw.key) && typeof raw.enabled === "boolean") return { kind, key: raw.key, enabled: raw.enabled };
	if (kind === "skill-enabled" && isNonEmpty(raw.name) && typeof raw.enabled === "boolean") return { kind, name: raw.name, enabled: raw.enabled };
	if (kind === "provider" && isNonEmpty(raw.id) && typeof raw.enabled === "boolean" && typeof raw.userOnly === "boolean") return { kind, id: raw.id, enabled: raw.enabled, userOnly: raw.userOnly };
	if (kind === "source-add" && isNonEmpty(raw.source)) return { kind, source: raw.source.trim() };
	if ((kind === "source-refresh" || kind === "source-remove") && isNonEmpty(raw.name)) return { kind, name: raw.name };
	if (kind === "registry" && isNonEmpty(raw.url)) {
		try {
			const url = new URL(raw.url);
			if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash && !url.search) return { kind, url: url.href.replace(/\/$/, "") };
		} catch {}
		throw new Rejected(400, "Use an http or https registry URL without credentials, a query, or a fragment");
	}
	throw new Rejected(400, "Invalid extension change");
}

type Job = { cwd: string | null; value: ExtensionOperation; approve?: { token: string; answer: (approved: boolean) => void } };
const jobs = new Map<string, Job>();
let pending: Promise<unknown> = Promise.resolve();

export function startExtensionChange(cwd: string | null, raw: unknown, apply = changeExtensions): ExtensionOperation {
	const change = parseExtensionChange(raw);
	const id = crypto.randomUUID();
	const warnings: string[] = [];
	const job: Job = { cwd, value: { id, state: "working", warnings } };
	jobs.set(id, job);
	const run = pending.then(async () => {
		try {
			await apply(cwd, change, {
				warn: warning => warnings.push(warning),
				confirmScripts: request => {
					const { promise, resolve } = Promise.withResolvers<boolean>();
					const token = crypto.randomUUID();
					const timeout = setTimeout(() => answer(false), 10 * 60_000);
					const answer = (approved: boolean) => {
						clearTimeout(timeout);
						delete job.approve;
						job.value = { id, state: "working", warnings };
						resolve(approved);
					};
					job.approve = { token, answer };
					job.value = { id, state: "needs-approval", warnings, approval: { token, id: request.id, version: request.version, files: request.files.map(({ path, executable }) => ({ path, executable })) } };
					return promise;
				},
			});
			job.value = { id, state: "done", warnings, message: "Saved on disk. New sessions use the new configuration. Running sessions have not been reloaded." };
		} catch (err) { job.value = { id, state: "failed", warnings, error: errorText(err) }; }
		setTimeout(() => jobs.delete(id), 60 * 60_000).unref();
	});
	pending = run.catch(() => {});
	return job.value;
}

export function readExtensionOperation(cwd: string | null, id: string): ExtensionOperation {
	const job = jobs.get(id);
	if (!job || job.cwd !== cwd) throw new Rejected(404, "No such extension operation in this workspace");
	return job.value;
}

export function answerExtensionApproval(cwd: string | null, raw: unknown): ExtensionOperation {
	if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.token !== "string" || typeof raw.approved !== "boolean") throw new Rejected(400, "Expected an operation id, approval token, and approved boolean");
	const job = jobs.get(raw.id);
	if (!job || job.cwd !== cwd || job.approve?.token !== raw.token) throw new Rejected(409, "This approval is no longer waiting for an answer");
	job.approve.answer(raw.approved);
	return job.value;
}

export async function readExtensionContribution(cwd: string | null, key: string): Promise<{ path: string; text: string }> {
	const snapshot = await loadExtensions(cwd);
	const item = [...snapshot.items, ...snapshot.packages.flatMap(pkg => pkg.contributions)].find(item => item.key === key);
	if (!item) throw new Rejected(404, "This contribution is no longer discovered");
	const file = Bun.file(item.path);
	if (file.size > 1024 * 1024) throw new Rejected(400, "This file exceeds the one MiB preview limit");
	return { path: item.path, text: await file.text() };
}
