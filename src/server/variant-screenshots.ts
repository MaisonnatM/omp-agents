import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { errorText } from "../json";
import type { RpcHostTool } from "../omp/modules";
import { isVariantStopped, type VariantScreenshot } from "../shared/comparisons";
import { mediaUrl } from "../shared/transcript";
import { rasterExtension } from "../variant-image";
import type { ComparisonEntry, ComparisonRecord } from "./comparison-records";

interface ScreenshotEnv {
	dir: string;
	entry(id: string): ComparisonEntry;
	change(entry: ComparisonEntry, change: (draft: ComparisonRecord) => void | Promise<void>): Promise<void>;
	cwd(instance: string): string | undefined;
}

export class VariantScreenshots {
	constructor(private readonly env: ScreenshotEnv) {}

	tool(comparison: string, variant: string, instanceId: string): RpcHostTool {
		return {
			name: "publish_variant_screenshot",
			label: "Publish variant screenshot",
			description: "Publish a real screenshot for this design variant. Capture the UI first, then pass the local PNG, JPEG, GIF, or WebP file path. A new publication replaces your previous screenshot in the comparison.",
			loadMode: "essential",
			parameters: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, caption: { type: "string" } }, required: ["path", "caption"] },
			execute: async (params, context) => {
				if (typeof params.path !== "string" || typeof params.caption !== "string" || params.caption.length > 2000) throw new Error("A screenshot path and caption are required.");
				return JSON.stringify(await this.publish(comparison, variant, context.toolCallId, params.path, params.caption, instanceId));
			},
		};
	}

	async publish(id: string, variant: string, toolCallId: string, path: string, caption: string, instanceId: string): Promise<VariantScreenshot> {
		const entry = this.env.entry(id);
		let published: VariantScreenshot | undefined;
		try {
			await this.env.change(entry, async draft => {
				const v = draft.snapshot.variants.find(v => v.id === variant);
				if (!v || draft.instances[instanceId] !== variant) throw new Error("This screenshot publisher belongs to a different session.");
				const key = JSON.stringify([instanceId, toolCallId]);
				if (draft.receipts[key]) {
					published = draft.receipts[key];
					return;
				}
				if (isVariantStopped(v.lifecycle)) throw new Error("This variant has stopped.");
				const source = resolve(this.env.cwd(instanceId) ?? v.cwd, path);
				const stat = await lstat(source);
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) throw new Error("Publish a regular raster image file of at most 20 MB.");
				const bytes = await readFile(source);
				const ext = await rasterExtension(bytes);
				const media = join(this.env.dir, id, "media");
				await mkdir(media, { recursive: true, mode: 0o700 });
				const destination = join(media, `${variant}-${randomUUID()}.${ext}`);
				await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
				published = { sequence: (v.screenshot?.sequence ?? 0) + 1, src: mediaUrl(destination), caption, publishedAt: Date.now() };
				draft.receipts[key] = published;
				v.screenshot = published;
				v.screenshotError = null;
			});
		} catch (error) {
			await this.env.change(entry, draft => {
				const v = draft.snapshot.variants.find(v => v.id === variant);
				if (v) v.screenshotError = errorText(error);
			});
			throw error;
		}
		if (!published) throw new Error("Screenshot publication did not commit.");
		return published;
	}
}
