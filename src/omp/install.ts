/** Where the installed omp package is, how to run its CLI, and how to read its `package.json`. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorText, isObject } from "../json";

const PACKAGE_NAME = "@oh-my-pi/pi-coding-agent";

/**
 * The JSON object in the `package.json` at `path`, read fresh from disk: `omp update` rewrites it while this server runs.
 * @throws Error naming `path` when the file cannot be read or holds no JSON object.
 */
export function readManifest(path: string): Record<string, unknown> {
	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new Error(`could not read the package manifest ${path}: ${errorText(err)}`);
	}
	if (!isObject(manifest)) throw new Error(`${path} is not a package manifest`);
	return manifest;
}

function findPackageDir(): string {
	const override = process.env.OMP_PACKAGE_DIR;
	if (override) return override;
	const bin = Bun.which("omp");
	if (!bin) throw new Error("`omp` is not on PATH; set OMP_PACKAGE_DIR to the installed @oh-my-pi/pi-coding-agent directory");
	let dir = dirname(realpathSync(bin));
	while (dir !== dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (existsSync(manifest) && readManifest(manifest).name === PACKAGE_NAME) return dir;
		dir = dirname(dir);
	}
	throw new Error(`could not find ${PACKAGE_NAME} above ${bin}; set OMP_PACKAGE_DIR`);
}

export const packageDir = findPackageDir();

/** The installed package's version and the path of its `omp` script, from its manifest. */
function readPackage(): { version: string; script: string } {
	const path = join(packageDir, "package.json");
	const manifest = readManifest(path);
	const script = isObject(manifest.bin) ? manifest.bin.omp : undefined;
	if (typeof manifest.version !== "string" || typeof script !== "string") throw new Error(`${path} names no version or no \`omp\` bin; set OMP_PACKAGE_DIR to the installed ${PACKAGE_NAME} directory`);
	return { version: manifest.version, script };
}

const installed = readPackage();
export const ompVersion: string = installed.version;
/** Runs this same package's CLI, so new sessions match the modules loaded here. */
export const ompCommand: string[] = [process.execPath, join(packageDir, installed.script)];
