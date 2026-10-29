/**
 * Builds the packaged macOS app, as T3 Code's script of the same name does: the platform-independent JavaScript once
 * (the server bundled, the page prebuilt, the shell's main process), a Bun runtime per architecture,
 * then electron-builder for a DMG and a zip, the zip and `latest-mac.yml` being what electron-updater reads.
 *
 *   bun scripts/build-desktop-artifact.ts [--arch arm64,x64] [--mock-update-port <port>]
 *
 * Signing is detected from the environment: with `CSC_LINK` set, electron-builder signs with that Developer ID and
 * notarizes through `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`; without it, the app is signed ad hoc,
 * which runs on the Mac that built it but which electron-updater cannot update.
 * `--mock-update-port` points the app's update feed at `scripts/mock-update-server.ts` instead of GitHub Releases.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";
import { buildPage } from "../src/server/page";

const ROOT = join(import.meta.dir, "..");
const DESKTOP = join(ROOT, "desktop");
const DIST = join(DESKTOP, "dist");
/** What the bundle's `Contents/Resources/server` holds; `OMP_AGENTS_RESOURCES` names it to the server (src/server/resources.ts). */
const RESOURCES = join(DIST, "resources");
const KIT = join(ROOT, "templates", "omp");
const BUN_ARCH: Record<string, string> = { arm64: "aarch64", x64: "x64" };
const REPOSITORY = { owner: "MaisonnatM", repo: "omp-agents" };

const { values: args } = parseArgs({ options: { arch: { type: "string", default: process.arch }, "mock-update-port": { type: "string" } } });
const arches = (args.arch ?? process.arch).split(",");
for (const arch of arches) if (!BUN_ARCH[arch]) throw new Error(`unsupported --arch ${arch}; use arm64, x64, or both`);

async function bundle(entry: string, outdir: string, naming: string, options: Partial<Bun.BuildConfig> = {}): Promise<void> {
	const build = await Bun.build({ entrypoints: [entry], outdir, naming, minify: true, ...options });
	if (!build.success) throw new AggregateError(build.logs, `cannot bundle ${entry}`);
}

/** The server, its page, the session visuals extension, and the starter kit, the same for every architecture. */
async function buildResources(): Promise<void> {
	rmSync(RESOURCES, { recursive: true, force: true });
	const pageDir = join(RESOURCES, "page");
	mkdirSync(pageDir, { recursive: true });
	for (const [path, blob] of await buildPage()) await Bun.write(join(pageDir, path), blob);
	// The packaged server reads the prebuilt page, so `buildPage`'s Tailwind import never runs there.
	await bundle(join(ROOT, "src", "server.ts"), RESOURCES, "server.js", { target: "bun", external: ["bun-plugin-tailwind"] });
	await bundle(join(ROOT, "src", "keeper.ts"), RESOURCES, "keeper.js", { target: "bun" });
	await bundle(join(ROOT, "src", "omp", "session-visuals-extension.ts"), RESOURCES, "session-visuals-extension.js", { target: "bun" });
	await bundle(join(ROOT, "src", "omp", "bot-extension.ts"), RESOURCES, "bot-extension.js", { target: "bun" });
	// The installer reads its layers beside itself, as `templates/omp/install.ts` does in a checkout.
	const kitOut = join(RESOURCES, "templates", "omp");
	cpSync(join(KIT, "agent"), join(kitOut, "agent"), { recursive: true });
	cpSync(join(KIT, "config.yml"), join(kitOut, "config.yml"));
	await bundle(join(KIT, "install.ts"), kitOut, "install.js", { target: "bun" });
}

/** The Bun this build runs on, for `arch`, which the app runs its server and omp sessions on; downloaded once per version. */
async function bunRuntime(arch: string): Promise<void> {
	const dir = join(DIST, `bun-${arch}`);
	const binary = join(dir, "bun");
	if (existsSync(binary) && (await $`${binary} --version`.nothrow().text()).trim() === Bun.version) return;
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const name = `bun-darwin-${BUN_ARCH[arch]}`;
	const url = `https://github.com/oven-sh/bun/releases/download/bun-v${Bun.version}/${name}.zip`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`cannot download ${url}: HTTP ${response.status}`);
	const zip = join(dir, `${name}.zip`);
	await Bun.write(zip, response);
	await $`ditto -x -k ${zip} ${dir}`.quiet();
	await $`mv ${join(dir, name, "bun")} ${binary}`.quiet();
	rmSync(zip);
	rmSync(join(dir, name), { recursive: true });
}

function builderConfig(): Record<string, unknown> {
	const signed = Boolean(process.env.CSC_LINK);
	const entitlements = join(DESKTOP, "entitlements.mac.plist");
	const mockPort = args["mock-update-port"];
	return {
		appId: JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8")).build.appId,
		productName: "omp agents",
		// Without spaces, so GitHub's asset names match the URLs in `latest-mac.yml`.
		artifactName: "omp-agents-${version}-${arch}.${ext}",
		directories: { output: join(DESKTOP, "release") },
		files: ["dist/main.cjs", "dist/preload.cjs", "dist/preview-preload.cjs", "icon.png", "package.json"],
		extraResources: [
			{ from: RESOURCES, to: "server" },
			{ from: join(DIST, "bun-${arch}"), to: "server/bin" },
		],
		electronLanguages: ["en"],
		mac: {
			target: [
				{ target: "dmg", arch: arches },
				{ target: "zip", arch: arches },
			],
			icon: join(DESKTOP, "icon.png"),
			category: "public.app-category.developer-tools",
			// Bun JIT-compiles, which the hardened runtime refuses without these.
			hardenedRuntime: signed,
			entitlements: signed ? entitlements : undefined,
			entitlementsInherit: signed ? entitlements : undefined,
			notarize: signed,
			identity: signed ? undefined : "-",
		},
		publish: mockPort ? { provider: "generic", url: `http://127.0.0.1:${mockPort}` } : { provider: "github", ...REPOSITORY },
	};
}

await buildResources();
await $`bun run build`.cwd(DESKTOP);
for (const arch of arches) await bunRuntime(arch);
const configFile = join(DIST, "electron-builder.json");
await Bun.write(configFile, JSON.stringify(builderConfig(), null, "\t"));
rmSync(join(DESKTOP, "release"), { recursive: true, force: true });
await $`${join(DESKTOP, "node_modules", ".bin", "electron-builder")} --mac --config ${configFile} --publish never`.cwd(DESKTOP);
console.log(`Built ${join(DESKTOP, "release")}`);
