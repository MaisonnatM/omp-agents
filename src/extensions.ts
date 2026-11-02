import { stat } from "node:fs/promises";
import { errorText, isNonEmpty, isObject } from "./json";
import { changeExtensions, findExtensionContribution } from "./omp/extensions";
import { displayPath } from "./paths";
import { SerialLane } from "./serial-lane";
import { Rejected } from "./settings";
import {
	EXTENSION_CONTRIBUTION_KINDS,
	type ExtensionChange,
	type ExtensionContributionTarget,
	type ExtensionOperation,
	type ExtensionTarget,
} from "./shared/extensions";
import type { ReadOnlyFile } from "./shared/models";

function parseTarget(raw: unknown, cwd: string | null): ExtensionTarget {
	if (!isObject(raw) || !isNonEmpty(raw.id) || (raw.scope !== "user" && raw.scope !== "project")) {
		throw new Rejected(400, "Expected a package kind, id, and scope");
	}
	if (raw.scope === "project" && cwd === null) throw new Rejected(400, "Pick a workspace before changing its packages");
	const id = raw.id.trim();
	switch (raw.kind) {
		case "plugin":
			if (raw.scope !== "user") throw new Rejected(400, "npm, git, and linked plugins install for all workspaces");
			return { kind: "plugin", id, scope: "user" };
		case "marketplace":
		case "registry-skill":
			return { kind: raw.kind, id, scope: raw.scope };
		default:
			throw new Rejected(400, "Unknown package kind");
	}
}

export function parseExtensionChange(raw: unknown, cwd: string | null): ExtensionChange {
	if (!isObject(raw)) throw new Rejected(400, "Expected an extension change");
	const { kind } = raw;
	if (kind === "install" && isNonEmpty(raw.spec) && typeof raw.source === "string") {
		const target = parseTarget({ kind: raw.packageKind, id: raw.spec, scope: raw.scope }, cwd);
		const base = { kind, spec: target.id, source: raw.source } as const;
		return target.kind === "plugin" ? { ...base, packageKind: "plugin", scope: "user" } : { ...base, packageKind: target.kind, scope: target.scope };
	}
	if (kind === "update" || kind === "uninstall") return { kind, target: parseTarget(raw.target, cwd) };
	if (kind === "enabled" && typeof raw.enabled === "boolean") {
		const target = parseTarget(raw.target, cwd);
		if (target.kind === "registry-skill") throw new Rejected(400, "Registry packages have no package switch. Enable or disable a named skill instead");
		return { kind, target, enabled: raw.enabled };
	}
	if (kind === "skill-enabled" && isNonEmpty(raw.name) && typeof raw.enabled === "boolean") return { kind, name: raw.name, enabled: raw.enabled };
	if (kind === "provider" && isNonEmpty(raw.id) && typeof raw.enabled === "boolean" && typeof raw.userOnly === "boolean") {
		return { kind, id: raw.id, enabled: raw.enabled, userOnly: raw.userOnly };
	}
	if (kind === "source-add" && isNonEmpty(raw.source)) return { kind, source: raw.source.trim() };
	if ((kind === "source-refresh" || kind === "source-remove") && isNonEmpty(raw.name)) return { kind, name: raw.name };
	if (kind === "registry" && isNonEmpty(raw.url)) {
		try {
			const url = new URL(raw.url);
			if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash && !url.search) {
				return { kind, url: url.href.replace(/\/$/, "") };
			}
		} catch {}
		throw new Rejected(400, "Use an http or https registry URL without credentials, a query, or a fragment");
	}
	throw new Rejected(400, "Invalid extension change");
}

type Job = { cwd: string | null } & (
	| { value: Exclude<ExtensionOperation, { state: "needs-approval" }> }
	| { value: Extract<ExtensionOperation, { state: "needs-approval" }>; answer: (approved: boolean) => void }
);
const jobs = new Map<string, Job>();
const changes = new SerialLane();

function needsApproval(job: Job): job is Extract<Job, { answer: unknown }> {
	return job.value.state === "needs-approval";
}

export function startExtensionChange(cwd: string | null, raw: unknown, apply = changeExtensions): ExtensionOperation {
	const change = parseExtensionChange(raw, cwd);
	const id = crypto.randomUUID();
	const warnings: string[] = [];
	const working: ExtensionOperation = { id, state: "working", warnings };
	jobs.set(id, { cwd, value: working });
	void changes.run(async () => {
		try {
			await apply(cwd, change, {
				warn: (warning) => warnings.push(warning),
				confirmScripts: (request) => {
					const { promise, resolve } = Promise.withResolvers<boolean>();
					const token = crypto.randomUUID();
					const timeout = setTimeout(() => answer(false), 10 * 60_000);
					const answer = (approved: boolean) => {
						clearTimeout(timeout);
						jobs.set(id, { cwd, value: working });
						resolve(approved);
					};
					jobs.set(id, {
						cwd,
						answer,
						value: {
							id,
							state: "needs-approval",
							warnings,
							approval: { token, id: request.id, version: request.version, files: request.files.map(({ path, executable }) => ({ path, executable })) },
						},
					});
					return promise;
				},
			});
			jobs.set(id, {
				cwd,
				value: { id, state: "done", warnings, message: "Saved on disk. New sessions use the new configuration. Running sessions have not been reloaded." },
			});
		} catch (err) {
			jobs.set(id, { cwd, value: { id, state: "failed", warnings, error: errorText(err) } });
		}
		setTimeout(() => jobs.delete(id), 60 * 60_000).unref();
	});
	return working;
}

export function readExtensionOperation(cwd: string | null, id: string): ExtensionOperation {
	const job = jobs.get(id);
	if (!job || job.cwd !== cwd) throw new Rejected(404, "No such extension operation in this workspace");
	return job.value;
}

export function answerExtensionApproval(cwd: string | null, raw: unknown): ExtensionOperation {
	if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.token !== "string" || typeof raw.approved !== "boolean") {
		throw new Rejected(400, "Expected an operation id, approval token, and approved boolean");
	}
	const job = jobs.get(raw.id);
	if (!job || job.cwd !== cwd || !needsApproval(job) || job.value.approval.token !== raw.token) {
		throw new Rejected(409, "This approval is no longer waiting for an answer");
	}
	job.answer(raw.approved);
	return readExtensionOperation(cwd, raw.id);
}

function parseContributionTarget(raw: unknown): ExtensionContributionTarget {
	if (isObject(raw) && isNonEmpty(raw.path) && isNonEmpty(raw.provider) && (raw.scope === "native" || raw.scope === "user" || raw.scope === "project")) {
		const kind = EXTENSION_CONTRIBUTION_KINDS.find((kind) => kind === raw.kind);
		if (kind) return { kind, path: raw.path, provider: raw.provider, scope: raw.scope };
	}
	throw new Rejected(400, "Expected a contribution kind, path, provider, and scope");
}

export async function readExtensionContribution(cwd: string | null, raw: unknown): Promise<ReadOnlyFile> {
	const item = await findExtensionContribution(cwd, parseContributionTarget(raw));
	if (!item) throw new Rejected(404, "This contribution is no longer discovered");
	const info = await stat(item.path);
	if (info.size > 1024 * 1024) throw new Rejected(400, "This file exceeds the one MiB preview limit");
	return {
		pathDisplay: displayPath(item.path),
		body: { state: "read", size: info.size, modifiedAt: info.mtimeMs, text: await Bun.file(item.path).text() },
	};
}
