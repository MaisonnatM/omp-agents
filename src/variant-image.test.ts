import { expect, test } from "bun:test";
import { rasterExtension } from "./variant-image";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

test("screenshot validation decodes actual PNG, JPEG, WebP and GIF bytes rather than trusting an extension", async () => {
	expect(await rasterExtension(GIF)).toBe("gif");
	for (const format of ["png", "jpeg", "webp"] as const) {
		const image = new Bun.Image(GIF);
		const bytes = await image[format]().bytes();
		expect(await rasterExtension(Buffer.from(bytes))).toBe(format === "jpeg" ? "jpg" : format);
	}
});

test("a valid-looking header, truncated raster, SVG, and arbitrary text are not screenshots", async () => {
	const png = Buffer.from(await new Bun.Image(GIF).png().bytes());
	await expect(rasterExtension(png.subarray(0, 40))).rejects.toThrow();
	const corrupt = Buffer.from(png);
	const payload = corrupt.indexOf("IDAT");
	corrupt[payload + 6] = 255;
	await expect(rasterExtension(corrupt)).rejects.toThrow();
	await expect(rasterExtension(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'))).rejects.toThrow();
	await expect(rasterExtension(Buffer.from("a plain text file renamed screenshot.png"))).rejects.toThrow();
});
