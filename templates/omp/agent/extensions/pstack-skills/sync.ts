// omp loads none of pstack's skills from its plugin: pstack's plugin.json opts into the Agent Plugins schema, whose
// closed skill frontmatter rejects the `disable-model-invocation` key nearly every pstack skill carries.
// `skills.customDirectories` scans skills leniently and reads that key as hidden, so this keeps one link per installed
// pstack skill in `~/.omp/plugins/pstack-skills`, which the kit's config lists there, and repoints them after a
// marketplace update unpacks a new version. A custom-directory skill takes its bare name from your own skills, so
// pstack's copies replace stale ones you keep; `poteto-mode` stays the kit's alias, which maps pstack's routes to omp.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PSTACK = "pstack@cursor-plugins";
const KIT_ALIASES = new Set(["poteto-mode"]);

export const PLUGINS_DIR = join(homedir(), ".omp", "plugins");

/** The user-scope pstack install's `skills/` directory, from omp's plugin registry; `undefined` when pstack is not installed. */
function installedSkills(pluginsDir: string): string | undefined {
	const registry = join(pluginsDir, "installed_plugins.json");
	if (!existsSync(registry)) return undefined;
	const entries: unknown = JSON.parse(readFileSync(registry, "utf8")).plugins?.[PSTACK];
	if (!Array.isArray(entries)) return undefined;
	const installPath = entries.find(entry => entry?.scope === "user")?.installPath;
	return typeof installPath === "string" && existsSync(join(installPath, "skills")) ? join(installPath, "skills") : undefined;
}

/**
 * Points `<pluginsDir>/pstack-skills/<name>` at each skill of the installed pstack, removes links to skills it no longer
 * has, and leaves anything there that is not a link alone. Returns the skills directory linked, or `undefined` without pstack.
 */
export function syncPstackSkills(pluginsDir = PLUGINS_DIR): string | undefined {
	const source = installedSkills(pluginsDir);
	if (!source) return undefined;
	const dir = join(pluginsDir, "pstack-skills");
	mkdirSync(dir, { recursive: true });
	const wanted = new Map(
		readdirSync(source)
			.filter(name => !KIT_ALIASES.has(name) && existsSync(join(source, name, "SKILL.md")))
			.map(name => [name, join(source, name)]),
	);
	for (const name of readdirSync(dir)) {
		const link = join(dir, name);
		if (!lstatSync(link).isSymbolicLink()) continue;
		if (readlinkSync(link) === wanted.get(name)) wanted.delete(name);
		else unlinkSync(link);
	}
	for (const [name, target] of wanted) {
		try {
			symlinkSync(target, join(dir, name));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}
	}
	return source;
}
