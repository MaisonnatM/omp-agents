/** Validates real raster bytes with Bun's native decoder, independently of the path's extension. */
export async function rasterExtension(bytes: Buffer): Promise<"png" | "jpg" | "gif" | "webp"> {
	if (bytes.length < 16 || bytes.length > 20 * 1024 * 1024) throw new Error("A screenshot must be a raster image of at most 20 MB.");
	const image = new Bun.Image(bytes, { maxPixels: 100_000_000 });
	const { format, width, height } = await image.metadata();
	if (!width || !height || !["png", "jpeg", "gif", "webp"].includes(format)) throw new Error("Publish a complete PNG, JPEG, GIF, or WebP screenshot. SVG and other files are not screenshots.");
	// Metadata alone accepts a header with corrupt pixel data. Decode the whole source, reducing the validation output to one pixel.
	await image.resize(1, 1).png().bytes();
	switch (format) {
		case "png": return "png";
		case "jpeg": return "jpg";
		case "gif": return "gif";
		case "webp": return "webp";
		default: throw new Error("Unsupported screenshot format.");
	}
}
