/**
 * Starts the desktop shell. On macOS the Dock, the menu bar, and Cmd+Tab take an app's name and icon from its bundle,
 * and the one in `node_modules` is Electron's, so this runs a copy of it that carries ours. Other systems run Electron as is.
 * Arguments pass through to Electron, for example `--remote-debugging-port`.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const DESKTOP_DIR = import.meta.dir;
const ELECTRON_DIST = join(DESKTOP_DIR, "node_modules", "electron", "dist");
const ICON = join(DESKTOP_DIR, "icon.png");
const BUNDLE_ID = "dev.omp-agents.desktop";
const BRANDED_APP = join(DESKTOP_DIR, "dist", "omp agents.app");
/** The sizes an `.icns` holds, each at 1x and 2x. */
const ICONSET_SIZES = [16, 32, 128, 256, 512];

/** Renders `icon.png` into the bundle's `.icns` through the system's own tools. */
async function writeIcns(target: string): Promise<void> {
	const iconset = `${target}.iconset`;
	rmSync(iconset, { recursive: true, force: true });
	mkdirSync(iconset, { recursive: true });
	for (const size of ICONSET_SIZES) {
		await $`sips -z ${size} ${size} ${ICON} --out ${join(iconset, `icon_${size}x${size}.png`)}`.quiet();
		await $`sips -z ${size * 2} ${size * 2} ${ICON} --out ${join(iconset, `icon_${size}x${size}@2x.png`)}`.quiet();
	}
	await $`iconutil -c icns ${iconset} -o ${target}`.quiet();
	rmSync(iconset, { recursive: true, force: true });
}

/** Copies Electron's app bundle and renames it. The copy is rebuilt when Electron or the icon changes. */
async function brandedElectron(): Promise<string> {
	const version = readFileSync(join(ELECTRON_DIST, "version"), "utf8").trim();
	const stamp = `${version}\n${createHash("sha256").update(readFileSync(ICON)).digest("hex")}`;
	const stampFile = join(BRANDED_APP, "..", "omp-agents.stamp");
	const binary = join(BRANDED_APP, "Contents", "MacOS", "Electron");
	if (existsSync(binary) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return binary;

	rmSync(BRANDED_APP, { recursive: true, force: true });
	mkdirSync(join(BRANDED_APP, ".."), { recursive: true });
	// `-c` clones on APFS, which makes the copy of ~250 MB instant; elsewhere cpSync copies the bytes.
	if ((await $`cp -cR ${join(ELECTRON_DIST, "Electron.app")} ${BRANDED_APP}`.quiet().nothrow()).exitCode !== 0) {
		cpSync(join(ELECTRON_DIST, "Electron.app"), BRANDED_APP, { recursive: true, verbatimSymlinks: true });
	}
	const resources = join(BRANDED_APP, "Contents", "Resources");
	rmSync(join(resources, "electron.icns"), { force: true });
	await writeIcns(join(resources, "icon.icns"));
	const plist = join(BRANDED_APP, "Contents", "Info.plist");
	for (const [key, value] of [
		["CFBundleName", "omp agents"],
		["CFBundleDisplayName", "omp agents"],
		["CFBundleIdentifier", BUNDLE_ID],
		["CFBundleIconFile", "icon.icns"],
	]) {
		await $`/usr/libexec/PlistBuddy -c ${`Set :${key} ${value}`} ${plist}`.quiet();
	}
	// Editing the plist breaks the bundle's seal, which Apple silicon refuses to run without.
	await $`codesign --force --deep --sign - ${BRANDED_APP}`.quiet();
	writeFileSync(stampFile, stamp);
	return binary;
}

const electron = process.platform === "darwin" ? await brandedElectron() : join(DESKTOP_DIR, "node_modules", ".bin", "electron");
const child = Bun.spawn([electron, DESKTOP_DIR, ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"], cwd: DESKTOP_DIR });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
