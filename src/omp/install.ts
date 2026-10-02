/** Where the installed omp package is, and how to run its CLI. */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const PACKAGE_NAME = "@oh-my-pi/pi-coding-agent";

function findPackageDir(): string {
	const override = process.env.OMP_PACKAGE_DIR;
	if (override) return override;
	const bin = Bun.which("omp");
	if (!bin) throw new Error("`omp` is not on PATH; set OMP_PACKAGE_DIR to the installed @oh-my-pi/pi-coding-agent directory");
	let dir = dirname(realpathSync(bin));
	while (dir !== dirname(dir)) {
		const manifest = join(dir, "package.json");
		if (existsSync(manifest) && require(manifest).name === PACKAGE_NAME) return dir;
		dir = dirname(dir);
	}
	throw new Error(`could not find ${PACKAGE_NAME} above ${bin}; set OMP_PACKAGE_DIR`);
}

export const packageDir = findPackageDir();

const manifest = require(join(packageDir, "package.json")) as { version: string; bin: { omp: string } };
export const ompVersion: string = manifest.version;
/** Runs this same package's CLI, so new sessions match the modules loaded here. */
export const ompCommand: string[] = [process.execPath, join(packageDir, manifest.bin.omp)];
