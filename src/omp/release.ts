/** omp's releases: the newest one on the channel omp follows, the one installed on disk, and `omp update`. */
import { join } from "node:path";
import { HOME } from "../paths";
import { run } from "../proc";
import { ompCommand, packageDir, readManifest } from "./install";
import { config, updateCli, updateSettings } from "./modules";

const RELEASE_TIMEOUT_MS = 10_000;
/** `omp update` downloads and installs a release, which a slow network can make take minutes. */
const UPDATE_TIMEOUT_MS = 300_000;

/** The newest omp release on the configured `update.channel`, or `null` when `startup.checkUpdate` turns the check off. */
export async function latestOmp(): Promise<string | null> {
	const settings = await config.Settings.loadReadOnly({ cwd: HOME });
	if (!updateSettings.cfgStartupCheckUpdate.get(settings)) return null;
	const release = await updateCli.getLatestRelease({ timeoutMs: RELEASE_TIMEOUT_MS, channel: updateSettings.cfgUpdateChannel.get(settings) });
	return release.version;
}

/** The version of the omp package on disk now, which `omp update` changes while this server keeps the modules it loaded. */
export function installedOmp(): string {
	const path = join(packageDir, "package.json");
	const manifest = readManifest(path);
	if (typeof manifest.version !== "string") throw new Error(`${path} names no version`);
	return manifest.version;
}

/**
 * Runs `omp update` and answers with the version on disk after it.
 * @throws Error with omp's last line when omp fails or leaves a version older than `latest`.
 */
export async function updateOmp(latest: string): Promise<string> {
	const { stdout, stderr, code } = await run([...ompCommand, "update"], { timeoutMs: UPDATE_TIMEOUT_MS });
	const after = installedOmp();
	if (code === 0 && Bun.semver.order(after, latest) >= 0) return after;
	const last = Bun.stripANSI(`${stdout}\n${stderr}`)
		.split("\n")
		.findLast(line => line.trim());
	throw new Error(last?.trim() || `omp update exited ${code}`);
}
