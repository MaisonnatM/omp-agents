/** The settings page: omp's model routing and the files omp reads, as a session in a workspace would load them, and the edits it saves. */
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { atomicWriteText } from "./fs";
import { errorText, isObject } from "./json";
import { agentSetting, readAgentSettings, userValue, writeAgentSetting } from "./omp/agent-settings";
import { readAgentCatalog } from "./omp/agents";
import {
	agentDir,
	assertRetryValue,
	configWrites,
	expandDefaultRetryFallbackChains,
	loadGlobalForWrite,
	loadOmpConfig,
	loadSessionSettings,
	type OmpConfig,
	ompConfigOf,
	resolveSelector,
	retryChoices,
	routedSelectors,
	writeRouting,
} from "./omp/config";
import { discoverOmpFiles, type FoundFile } from "./omp/discovery";
import { findModelUpdates, upgradeEdits } from "./omp/model-updates";
import { connectedProviders, listModels } from "./omp/models";
import { workflowsOf } from "./omp/workflows";
import { displayPath, HOME } from "./paths";
import type { AgentOverrideEntryEdit, AgentSettingEdit } from "./shared/agent-settings";
import { AGENT_SETTINGS, isAgentModelOverride } from "./shared/agents";
import type { CatalogModel, FileEdit, ModelChain, OmpFile, OmpSettings, RetrySettings, RoleRoute, RoutingEdit } from "./shared/models";
import type { ModelUpdate } from "./shared/notices";

/**
 * An edit the settings refuse, with the HTTP status the API answers it with: 400 for an edit omp could not use, 404 for
 * a file omp does not read, 409 for a file or config in a state that blocks the save. `conflict`: the file changed on
 * disk since the page read it.
 */
export class Rejected extends Error {
	constructor(
		readonly status: 400 | 404 | 409,
		message: string,
		readonly conflict = false,
	) {
		super(message);
	}
}

/**
 * Every role omp knows a model or a chain for, in config order, with the fallbacks omp walks for it.
 * Chain keys with a `/` name a model or provider wildcard rather than a role (omp's `isRetryFallbackModelKey`).
 */
export function routeRoles(modelRoles: Record<string, string>, configuredChains: Record<string, string[]>): { roles: RoleRoute[]; modelChains: ModelChain[] } {
	const chainKeys = Object.keys(configuredChains);
	const roleNames = [...new Set([...Object.keys(modelRoles), ...chainKeys.filter((key) => !key.includes("/"))])];
	const effective = expandDefaultRetryFallbackChains(configuredChains, roleNames);
	return {
		roles: roleNames.map((role) => ({
			role,
			primary: modelRoles[role] ?? null,
			fallbacks: effective[role] ?? [],
			inheritsDefault: configuredChains[role] === undefined && effective[role] !== undefined,
		})),
		modelChains: chainKeys.filter((key) => key.includes("/")).map((key) => ({ key, fallbacks: configuredChains[key] ?? [] })),
	};
}

/** Reading a file never throws: a file that is not there or cannot be read says so. */
async function readFile({ kind, scope, path, packaged }: FoundFile): Promise<OmpFile> {
	let body: OmpFile["body"];
	try {
		const [info, text] = await Promise.all([stat(path), Bun.file(path).text()]);
		body = { state: "read", size: info.size, modifiedAt: info.mtimeMs, text, hash: new Bun.CryptoHasher("sha256").update(text).digest("hex") };
	} catch (err) {
		body = (err as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unreadable", error: errorText(err) };
	}
	return { kind, scope, path, pathDisplay: displayPath(path), body, ...(packaged && { packaged }) };
}

/** Files omp reads from its own directory, listed even before they exist so the page shows where they go. */
const USER_FILES: FoundFile[] = [
	{ kind: "context", scope: "user", path: join(agentDir, "AGENTS.md") },
	{ kind: "settings", scope: "user", path: join(agentDir, "config.yml") },
];

/**
 * omp's routing and settings and the files a session in `cwd` loads, user-level only when `cwd` is `null`, from one
 * load of omp's settings. A config omp cannot load still lists the files, so the page can show the broken `config.yml`.
 */
async function loadSession(
	cwd: string | null,
): Promise<{ routing: OmpSettings["routing"]; agentSettings: OmpSettings["agentSettings"]; agents: OmpSettings["agents"]; found: FoundFile[] }> {
	const sessionCwd = cwd ?? HOME;
	let routing: OmpSettings["routing"];
	let agentSettings: OmpSettings["agentSettings"];
	let agents: OmpSettings["agents"];
	let disabledExtensions: string[] = [];
	try {
		const settings = await loadSessionSettings(cwd ?? "/");
		const config = ompConfigOf(settings);
		disabledExtensions = config.disabledExtensions;
		routing = {
			...routeRoles(config.modelRoles, config.fallbackChains),
			retry: config.retry,
			retryChoices: Object.fromEntries(
				(Object.keys(config.retry) as (keyof RetrySettings)[]).flatMap((key) => {
					const choices = retryChoices(key);
					return choices ? [[key, choices]] : [];
				}),
			),
			modelProviderOrder: config.modelProviderOrder,
		};
		agentSettings = readAgentSettings(settings, cwd !== null);
		agents = await readAgentCatalog(cwd, settings).catch((err: unknown) => ({ error: errorText(err) }));
	} catch (err) {
		routing = { error: errorText(err) };
		agentSettings = routing;
		agents = routing;
	}
	// From the home directory omp reads other tools' dot-directories as project files; without a workspace there is no project.
	const found = (await discoverOmpFiles(sessionCwd, disabledExtensions)).filter(file => cwd !== null || file.scope === "user");
	const placeholders = USER_FILES.filter(file => !found.some(other => other.kind === file.kind && other.scope === "user"));
	return { routing, agentSettings, agents, found: [...found, ...placeholders] };
}

export async function loadOmpSettings(cwd: string | null): Promise<OmpSettings> {
	const { routing, agentSettings, agents, found } = await loadSession(cwd);
	return { cwd, routing, agentSettings, agents, files: await Promise.all(found.map(readFile)), workflows: workflowsOf(found) };
}

/** What a routing edit is checked against: the models omp lists, and what the config names today. */
export interface RoutingContext {
	catalog: CatalogModel[];
	config: Pick<OmpConfig, "modelRoles" | "fallbackChains" | "retry" | "modelProviderOrder">;
}

function stringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw new Rejected(400, `${field} must be a list of strings`);
	}
	return value;
}

/**
 * `raw` as an edit omp may write. A selector must name a model `omp models` lists, with an optional `:level`.
 * One the config already names passes as it is, so saving a chain never forces dropping an entry the user kept.
 */
export function parseRoutingEdit(raw: unknown, { catalog, config }: RoutingContext): RoutingEdit {
	if (!isObject(raw) || Array.isArray(raw)) throw new Rejected(400, "Expected a JSON object");
	const known = new Set(catalog.map((model) => model.selector));
	const configured = new Set(routedSelectors(config));
	const selector = (value: unknown, field: string): string => {
		if (typeof value !== "string") throw new Rejected(400, `${field} must be a model selector`);
		if (!configured.has(value) && !resolveSelector(value, known)) throw new Rejected(400, `omp lists no model ${value}`);
		return value;
	};
	const chain = (value: unknown): string[] => stringList(value, "fallbacks").map((entry) => selector(entry, "A fallback"));
	switch (raw.kind) {
		case "role": {
			const { role } = raw;
			if (typeof role !== "string" || role.includes("/") || !(role in config.modelRoles || role in config.fallbackChains)) {
				throw new Rejected(400, `No role ${String(role)} is configured`);
			}
			if (raw.primary === undefined && raw.fallbacks === undefined) throw new Rejected(400, "Nothing to change");
			return {
				kind: "role",
				role,
				...(raw.primary !== undefined && { primary: selector(raw.primary, "primary") }),
				...(raw.fallbacks !== undefined && { fallbacks: chain(raw.fallbacks) }),
			};
		}
		case "model-chain": {
			const { key } = raw;
			if (typeof key !== "string" || !key.includes("/") || !(key in config.fallbackChains)) {
				throw new Rejected(400, `No chain for model ${String(key)} is configured`);
			}
			return { kind: "model-chain", key, fallbacks: chain(raw.fallbacks) };
		}
		case "retry": {
			const { values } = raw;
			if (!isObject(values) || Array.isArray(values) || Object.keys(values).length === 0) {
				throw new Rejected(400, "values must name at least one retry setting");
			}
			for (const [key, value] of Object.entries(values)) {
				if (!(key in config.retry)) throw new Rejected(400, `retry.${key} is not a setting this page edits`);
				try {
					assertRetryValue(key as keyof RetrySettings, value);
				} catch (err) {
					throw new Rejected(400, errorText(err));
				}
			}
			return { kind: "retry", values: values as Partial<RetrySettings> };
		}
		case "provider-order": {
			const providers = stringList(raw.providers, "providers");
			const knownProviders = new Set([...catalog.map((model) => model.provider), ...config.modelProviderOrder]);
			const unknown = providers.find((provider) => !knownProviders.has(provider));
			if (unknown !== undefined) throw new Rejected(400, `omp lists no provider ${unknown}`);
			if (new Set(providers).size !== providers.length) throw new Rejected(400, "A provider is listed twice");
			return { kind: "provider-order", providers };
		}
		default:
			throw new Rejected(400, `Unknown edit kind ${String(raw.kind)}`);
	}
}

/** A config omp cannot load is one it would move aside to write, so a write waits until the user fixes it. */
const cannotLoad = (err: unknown): Rejected => new Rejected(409, `omp cannot load its settings, so it cannot write them: ${errorText(err)}`);

/** Applies a routing edit to the user's `config.yml` and answers with the settings as they now load. */
export function saveRouting(cwd: string | null, raw: unknown): Promise<OmpSettings> {
	return configWrites.run(async () => {
		const sessionCwd = cwd ?? HOME;
		let config: OmpConfig;
		try {
			config = await loadOmpConfig(sessionCwd);
		} catch (err) {
			throw cannotLoad(err);
		}
		const edit = parseRoutingEdit(raw, { catalog: await listModels(), config });
		await writeRouting(sessionCwd, edit);
		return loadOmpSettings(cwd);
	});
}

function parseOverrideEntryEdit(raw: Record<string, unknown>): AgentOverrideEntryEdit {
	if (raw.id !== AGENT_SETTINGS.overrides || typeof raw.entry !== "string" || !raw.entry.trim()) {
		throw new Rejected(400, "An agent model override entry must name an agent");
	}
	if (raw.expected !== null && !isAgentModelOverride(raw.expected)) {
		throw new Rejected(400, "Expected the saved model selector, ordered selectors, or null");
	}
	const base: Pick<AgentOverrideEntryEdit, "id" | "entry" | "expected"> = { id: AGENT_SETTINGS.overrides, entry: raw.entry, expected: raw.expected };
	if (raw.reset === true) return { ...base, reset: true };
	if (!isAgentModelOverride(raw.value) || !(typeof raw.value === "string" ? raw.value.trim() : raw.value.length > 0 && raw.value.every(value => value.trim()))) {
		throw new Rejected(400, "Choose a model or a nonempty ordered list of model selectors");
	}
	return { ...base, value: raw.value };
}

export function parseAgentSettingEdit(raw: unknown): AgentSettingEdit {
	if (!isObject(raw) || typeof raw.id !== "string" || !Object.hasOwn(raw, "expected") || (raw.reset !== true && !Object.hasOwn(raw, "value"))) {
		throw new Rejected(400, "Expected { id, value, expected } or { id, reset: true, expected }");
	}
	if (raw.entry !== undefined) return parseOverrideEntryEdit(raw);
	return raw.reset === true ? { id: raw.id, reset: true, expected: raw.expected } : { id: raw.id, value: raw.value, expected: raw.expected };
}

/**
 * Sets or resets one of omp's settings in the user's `config.yml`, as omp's own settings panel would, and answers with the settings as they now load.
 * Any setting omp has is taken, except one that only changes how omp's terminal draws.
 */
export function saveAgentSetting(cwd: string | null, raw: unknown): Promise<OmpSettings> {
	return configWrites.run(async () => {
		const edit = parseAgentSettingEdit(raw);
		const handle = agentSetting(edit.id);
		if (!handle) throw new Rejected(404, `omp has no setting ${edit.id} a session reads`);
		if (!("reset" in edit)) {
			try {
				handle.assertWritable(edit.entry === undefined ? edit.value : { [edit.entry]: edit.value });
			} catch (err) {
				throw new Rejected(400, errorText(err));
			}
		}
		const settings = await loadGlobalForWrite(cwd ?? HOME).catch((err: unknown) => {
			throw cannotLoad(err);
		});
		if (!Bun.deepEquals(userValue(handle, settings, edit), edit.expected)) {
			throw new Rejected(409, `${edit.entry === undefined ? edit.id : `Model override for ${edit.entry}`} changed in config.yml since this page read it`, true);
		}
		await writeAgentSetting(settings, handle, edit);
		return loadOmpSettings(cwd);
	});
}

/** Each model the user's routing names that has a newer version `omp models` lists, as {@link findModelUpdates} finds them. */
export async function modelUpdates(): Promise<ModelUpdate[]> {
	const [catalog, connected, config] = await Promise.all([listModels(), connectedProviders(), loadOmpConfig(HOME)]);
	return findModelUpdates(catalog, config, connected);
}

/** Names `update.to` in the user's `config.yml` wherever it names `update.from`, each role and fallback keeping its level. */
export function upgradeModel({ provider, from, to }: ModelUpdate): Promise<void> {
	return configWrites.run(async () => {
		const [catalog, config] = await Promise.all([listModels(), loadOmpConfig(HOME)]);
		const edits = upgradeEdits(config, catalog, provider, from.id, to.id);
		if (edits.length === 0) throw new Error(`The routing no longer names ${provider}/${from.id}`);
		for (const edit of edits) await writeRouting(HOME, parseRoutingEdit(edit, { catalog, config }));
	});
}

/** Syntax checks by file extension, so a save cannot leave a file omp fails to parse. */
const PARSERS: Record<string, [string, (text: string) => unknown]> = {
	".yml": ["YAML", (text) => Bun.YAML.parse(text)],
	".yaml": ["YAML", (text) => Bun.YAML.parse(text)],
	".json": ["JSON", (text) => JSON.parse(text)],
};

function checkSyntax(file: FoundFile, text: string): void {
	const parser = PARSERS[extname(file.path)];
	if (!parser) return;
	const [language, parse] = parser;
	let value: unknown;
	try {
		value = parse(text);
	} catch (err) {
		throw new Rejected(400, `This is not valid ${language}: ${errorText(err)}`);
	}
	// omp refuses a settings file whose top level is not a mapping.
	if (file.kind === "settings" && value != null && (!isObject(value) || Array.isArray(value))) {
		throw new Rejected(400, `omp reads settings from a ${language} mapping, and this is not one`);
	}
}

function parseFileEdit(raw: unknown): FileEdit {
	if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.text !== "string" || (raw.baseHash !== null && typeof raw.baseHash !== "string")) {
		throw new Rejected(400, "Expected { path, text, baseHash }");
	}
	return { path: raw.path, text: raw.text, baseHash: raw.baseHash };
}

/**
 * Writes a file the page listed for `cwd`. `path` must be one omp's discovery finds for `cwd` right now,
 * and the file must still hash to `baseHash`; the answer is the settings as they now load.
 */
export function saveOmpFile(cwd: string | null, raw: unknown): Promise<OmpSettings> {
	return configWrites.run(async () => {
		const edit = parseFileEdit(raw);
		const file = (await loadSession(cwd)).found.find((found) => found.path === edit.path && !found.packaged);
		if (!file) throw new Rejected(404, `omp does not read ${displayPath(edit.path)} here`);
		const { body, pathDisplay } = await readFile(file);
		if (body.state === "unreadable") throw new Rejected(409, `Cannot read ${pathDisplay}: ${body.error}`);
		if ((body.state === "read" ? body.hash : null) !== edit.baseHash) {
			throw new Rejected(409, `${pathDisplay} changed on disk since this page read it`, true);
		}
		checkSyntax(file, edit.text);
		// Write next to the target, not the symlink: replacing the symlink would strand omp's config elsewhere.
		const target = body.state === "read" ? await realpath(file.path) : file.path;
		await mkdir(dirname(target), { recursive: true });
		await atomicWriteText(target, edit.text, body.state === "read" ? (await stat(target)).mode & 0o777 : undefined);
		return loadOmpSettings(cwd);
	});
}
