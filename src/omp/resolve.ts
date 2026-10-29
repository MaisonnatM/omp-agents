/** Resolves omp only when called, so importing the installer's read-only planning helpers needs no installation. */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorText, isObject } from "../json";
import { OMP_INSTALL_COMMAND, OmpMissing } from "../shared/startup";

const PACKAGE_NAME = "@oh-my-pi/pi-coding-agent";

/** Reads fresh because omp update can replace the manifest while the dashboard runs. */
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

function present(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch (err) {
		if (isObject(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) return false;
		throw err;
	}
}

function findPackageDir(): string {
	const override = process.env.OMP_PACKAGE_DIR;
	if (override) {
		if (!present(join(override, "package.json"))) throw new OmpMissing(`OMP_PACKAGE_DIR does not resolve an installed omp package: ${override}`);
		return override;
	}
	const bin = Bun.which("omp");
	if (!bin) throw new OmpMissing(`\`omp\` is not on PATH; install it with \`${OMP_INSTALL_COMMAND}\`, or set OMP_PACKAGE_DIR to its installed directory`);
	let resolved: string;
	try {
		resolved = realpathSync(bin);
	} catch (err) {
		if (isObject(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) throw new OmpMissing(`\`omp\` does not resolve an installed package: ${bin}`);
		throw err;
	}
	let dir = dirname(resolved);
	while (dir !== dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (present(manifest) && readManifest(manifest).name === PACKAGE_NAME) return dir;
		dir = dirname(dir);
	}
	// omp update can replace Bun's link with a compiled binary beside Bun's global packages.
	const global = join(dirname(dirname(bin)), "install/global/node_modules", PACKAGE_NAME);
	if (present(join(global, "package.json"))) return global;
	throw new OmpMissing(`could not find ${PACKAGE_NAME} above ${bin}; set OMP_PACKAGE_DIR`);
}

export function resolveOmp(): { packageDir: string; version: string; command: string[] } {
	const packageDir = findPackageDir();
	const path = join(packageDir, "package.json");
	const manifest = readManifest(path);
	const script = isObject(manifest.bin) ? manifest.bin.omp : undefined;
	if (typeof manifest.version !== "string" || typeof script !== "string") throw new Error(`${path} names no version or no \`omp\` bin; set OMP_PACKAGE_DIR to the installed ${PACKAGE_NAME} directory`);
	return { packageDir, version: manifest.version, command: [process.execPath, join(packageDir, script)] };
}
