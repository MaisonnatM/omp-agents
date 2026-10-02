/** The settings page: omp's model routing and the files omp reads, as a session in a workspace would load them, and the edits it saves. */
import { randomBytes } from "node:crypto";
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { errorText, isObject } from "./json";
import { agentDir, assertRetryValue, expandDefaultRetryFallbackChains, loadOmpConfig, type OmpConfig, parseRetryFallbackSelector, retryChoices, writeRouting } from "./omp/config";
import { discoverOmpFiles, type FoundFile } from "./omp/discovery";
import { listModels } from "./omp/models";
import { displayPath, HOME } from "./paths";
import { Rejected } from "./server/http";
import type { CatalogModel, FileEdit, ModelChain, OmpFile, OmpSettings, RetrySettings, RoleRoute, RoutingEdit } from "./shared";

/**
 * Every role omp knows a model or a chain for, in config order, with the fallbacks omp walks for it.
 * Chain keys with a `/` name a model or provider wildcard rather than a role (omp's `isRetryFallbackModelKey`).
 */
export function routeRoles(
	modelRoles: Record<string, string>,
	configuredChains: Record<string, string[]>,
): { roles: RoleRoute[]; modelChains: ModelChain[] } {
	const chainKeys = Object.keys(configuredChains);
	const roleNames = [...new Set([...Object.keys(modelRoles), ...chainKeys.filter(key => !key.includes("/"))])];
	const effective = expandDefaultRetryFallbackChains(configuredChains, roleNames);
	return {
		roles: roleNames.map(role => ({
			role,
			primary: modelRoles[role] ?? null,
			fallbacks: effective[role] ?? [],
			inheritsDefault: configuredChains[role] === undefined && effective[role] !== undefined,
		})),
		modelChains: chainKeys.filter(key => key.includes("/")).map(key => ({ key, fallbacks: configuredChains[key] ?? [] })),
	};
}

/** Reading a file never throws: a file that is not there or cannot be read says so. */
async function readFile({ kind, scope, path }: FoundFile): Promise<OmpFile> {
	let body: OmpFile["body"];
	try {
		const [info, text] = await Promise.all([stat(path), Bun.file(path).text()]);
		body = { state: "read", size: info.size, modifiedAt: info.mtimeMs, text, hash: new Bun.CryptoHasher("sha256").update(text).digest("hex") };
	} catch (err) {
		body =
			(err as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unreadable", error: errorText(err) };
	}
	return { kind, scope, path, pathDisplay: displayPath(path), body };
}

/** Files omp reads from its own directory, listed even before they exist so the page shows where they go. */
const USER_FILES: FoundFile[] = [
	{ kind: "context", scope: "user", path: join(agentDir, "AGENTS.md") },
	{ kind: "settings", scope: "user", path: join(agentDir, "config.yml") },
];

/**
 * omp's routing and the files a session in `cwd` loads, user-level only when `cwd` is `null`.
 * A config omp cannot load still lists the files, so the page can show the broken `config.yml`.
 */
async function loadSession(cwd: string | null): Promise<{ routing: OmpSettings["routing"]; found: FoundFile[] }> {
	const sessionCwd = cwd ?? HOME;
	let routing: OmpSettings["routing"];
	let disabledExtensions: string[] = [];
	try {
		const config = await loadOmpConfig(sessionCwd);
		disabledExtensions = config.disabledExtensions;
		routing = {
			...routeRoles(config.modelRoles, config.fallbackChains),
			retry: config.retry,
			retryChoices: Object.fromEntries(
				(Object.keys(config.retry) as (keyof RetrySettings)[]).flatMap(key => {
					const choices = retryChoices(key);
					return choices ? [[key, choices]] : [];
				}),
			),
			modelProviderOrder: config.modelProviderOrder,
		};
	} catch (err) {
		routing = { error: errorText(err) };
	}
	// From the home directory omp reads other tools' dot-directories as project files; without a workspace there is no project.
	const found = (await discoverOmpFiles(sessionCwd, disabledExtensions)).filter(file => cwd !== null || file.scope === "user");
	const placeholders = USER_FILES.filter(file => !found.some(other => other.kind === file.kind && other.scope === "user"));
	return { routing, found: [...found, ...placeholders] };
}

export async function loadOmpSettings(cwd: string | null): Promise<OmpSettings> {
	const { routing, found } = await loadSession(cwd);
	return { cwd, routing, files: await Promise.all(found.map(readFile)) };
}

/** What a routing edit is checked against: the models omp lists, and what the config names today. */
export interface RoutingContext {
	catalog: CatalogModel[];
	config: Pick<OmpConfig, "modelRoles" | "fallbackChains" | "retry" | "modelProviderOrder">;
}

function stringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || !value.every(entry => typeof entry === "string")) {
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
	const known = new Set(catalog.map(model => model.selector));
	const configured = new Set([
		...Object.values(config.modelRoles),
		...Object.entries(config.fallbackChains).flatMap(([key, chain]) => [key, ...chain]),
	]);
	const lookup = { find: (provider: string, id: string) => (known.has(`${provider}/${id}`) ? true : undefined) };
	const selector = (value: unknown, field: string): string => {
		if (typeof value !== "string") throw new Rejected(400, `${field} must be a model selector`);
		if (configured.has(value)) return value;
		const parsed = parseRetryFallbackSelector(value, lookup);
		if (!parsed || !known.has(`${parsed.provider}/${parsed.id}`)) throw new Rejected(400, `omp lists no model ${value}`);
		return value;
	};
	const chain = (value: unknown): string[] => stringList(value, "fallbacks").map(entry => selector(entry, "A fallback"));
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
			const knownProviders = new Set([...catalog.map(model => model.provider), ...config.modelProviderOrder]);
			const unknown = providers.find(provider => !knownProviders.has(provider));
			if (unknown !== undefined) throw new Rejected(400, `omp lists no provider ${unknown}`);
			if (new Set(providers).size !== providers.length) throw new Rejected(400, "A provider is listed twice");
			return { kind: "provider-order", providers };
		}
		default:
			throw new Rejected(400, `Unknown edit kind ${String(raw.kind)}`);
	}
}

/** One save at a time, so two saves of the same file cannot both pass the check that it is unchanged. */
let saving: Promise<unknown> = Promise.resolve();
function serialized<T>(save: () => Promise<T>): Promise<T> {
	const next = saving.then(save, save);
	saving = next.catch(() => {});
	return next;
}

/** Applies a routing edit to the user's `config.yml` and answers with the settings as they now load. */
export function saveRouting(cwd: string | null, raw: unknown): Promise<OmpSettings> {
	return serialized(async () => {
		const sessionCwd = cwd ?? HOME;
		let config: OmpConfig;
		try {
			config = await loadOmpConfig(sessionCwd);
		} catch (err) {
			throw new Rejected(409, `omp cannot load its settings, so it cannot write them: ${errorText(err)}`);
		}
		const edit = parseRoutingEdit(raw, { catalog: await listModels(), config });
		await writeRouting(sessionCwd, edit);
		return loadOmpSettings(cwd);
	});
}

/** Syntax checks by file extension, so a save cannot leave a file omp fails to parse. */
const PARSERS: Record<string, [string, (text: string) => unknown]> = {
	".yml": ["YAML", text => Bun.YAML.parse(text)],
	".yaml": ["YAML", text => Bun.YAML.parse(text)],
	".json": ["JSON", text => JSON.parse(text)],
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
	if (
		!isObject(raw) ||
		typeof raw.path !== "string" ||
		typeof raw.text !== "string" ||
		(raw.baseHash !== null && typeof raw.baseHash !== "string")
	) {
		throw new Rejected(400, "Expected { path, text, baseHash }");
	}
	return { path: raw.path, text: raw.text, baseHash: raw.baseHash };
}

/**
 * Writes a file the page listed for `cwd`. `path` must be one omp's discovery finds for `cwd` right now,
 * and the file must still hash to `baseHash`; the answer is the settings as they now load.
 */
export function saveOmpFile(cwd: string | null, raw: unknown): Promise<OmpSettings> {
	return serialized(async () => {
		const edit = parseFileEdit(raw);
		const file = (await loadSession(cwd)).found.find(found => found.path === edit.path);
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
		const mode = body.state === "read" ? (await stat(target)).mode & 0o777 : undefined;
		const temp = join(dirname(target), `.${basename(target)}.${randomBytes(8).toString("hex")}.tmp`);
		const handle = await open(temp, "wx", mode);
		let replaced = false;
		try {
			try {
				await handle.writeFile(edit.text);
			} finally {
				await handle.close();
			}
			await rename(temp, target);
			replaced = true;
		} finally {
			if (!replaced) await rm(temp, { force: true });
		}
		return loadOmpSettings(cwd);
	});
}
