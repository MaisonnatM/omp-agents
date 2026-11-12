import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const SOURCE_KINDS: Record<string, "html" | "markdown" | "svg"> = { ".html": "html", ".htm": "html", ".md": "markdown", ".markdown": "markdown", ".svg": "svg" };
const MAX_BYTES = 2 * 1024 * 1024;
const VERSIONS_DIR = "artifact-versions";
const inside = (root: string, file: string): boolean => {
	const rel = relative(root, file);
	return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};

export default function artifact(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind === "sub") await pi.setActiveTools(pi.getActiveTools().filter(name => name !== "artifact"));
	});
	const z = pi.zod;
	const parameters = z.object({
		path: z.string().trim().min(1).describe("The file under local:// to save."),
		title: z.string().trim().min(1).describe("The artifact's short title."),
		note: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/).optional().describe("Say in a few words what this version changed, on one short line."),
	});
	pi.registerTool({
		name: "artifact",
		label: "Artifact",
		loadMode: "essential",
		parameters,
		description: "Save a file as an artifact the user sees in a tab beside the conversation. Make one on your own for a page, an SVG image, or a document the user will look at again or reuse, and whenever the user asks. Never for a short answer, a code change, or a diagram that belongs in the reply. Write the file under local:// first, then call this tool; after each edit, call it again with the same path to save the new version, and say in a few words what this version changed in note. HTML must be one self-contained file, with CSS and JS inline or from a CDN.",
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const refuse = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
			const parsed = parameters.safeParse(raw);
			if (!parsed.success) return refuse("Expected a local:// path and a title.");
			if (ctx.agent.kind === "sub") return refuse("Only the main session saves artifacts.");
			const dir = ctx.sessionManager.getArtifactsDir();
			if (!dir) return refuse("This session has no artifacts directory.");
			const { path, title, note = null } = parsed.data;
			if (!path.startsWith("local://")) return refuse("Write the file under local:// first.");
			const file = path.slice("local://".length);
			if (!file || file.includes("\\") || file.includes("\0") || file.split("/").some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(file)) return refuse("The file must stay under local://.");
			const kind = SOURCE_KINDS[extname(file).toLowerCase()];
			if (!kind) return refuse("Artifacts support HTML, Markdown, and SVG files.");
			try {
				const root = await realpath(join(dir, "local"));
				const source = await realpath(resolve(root, file));
				if (!inside(root, source)) return refuse("The file must stay under local://.");
				const info = await stat(source);
				if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES) return refuse("Save a non-empty file of at most 2 MiB.");
				const bytes = await readFile(source);
				if (!bytes.length || bytes.length > MAX_BYTES) return refuse("Save a non-empty file of at most 2 MiB.");
				let text: string;
				try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
				catch { return refuse("Artifacts must be UTF-8 text."); }
				if (kind === "svg" && !/<svg(?:\s|\/?>)/i.test(text)) return refuse("The SVG file must contain an <svg> element.");
				const sha256 = createHash("sha256").update(bytes).digest("hex");
				await keepVersion(dir, sha256, kind, bytes);
				return { content: [{ type: "text", text: `Saved ${title}. The user sees it in the Artifacts tab.` }], details: { file, kind, title, note, sha256, bytes: bytes.length } };
			} catch (err) {
				return refuse(`Could not save the artifact. ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	});
}

async function keepVersion(dir: string, sha256: string, kind: string, bytes: Uint8Array): Promise<void> {
	const folder = join(dir, VERSIONS_DIR);
	await mkdir(folder, { recursive: true });
	const destination = join(folder, `${sha256}.${kind}`);
	try { await access(destination); return; }
	catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
	const temporary = `${destination}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes, { flag: "wx" });
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}
