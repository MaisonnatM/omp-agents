import { describe, expect, test } from "bun:test";
import { ARTIFACT_IMAGES_MESSAGE, ARTIFACT_KINDS, parseArtifactImages, parseArtifactSave, parseVersionName, versionName } from "./artifacts";

const save = { file: "pages/index.html", kind: "html", title: "Page", note: null, sha256: "a".repeat(64), bytes: 12, savedAt: 1_700_000_000_000 };

describe("artifact boundaries", () => {
	test("accepts every kind and round-trips its version name", () => {
		for (const kind of ARTIFACT_KINDS) {
			const parsed = parseArtifactSave({ ...save, kind });
			expect(parsed).toMatchObject({ file: save.file, kind, title: save.title, note: null, bytes: save.bytes, savedAt: save.savedAt });
			expect(String(parsed!.sha256)).toBe(save.sha256);
			expect(parseVersionName(versionName(parsed!))).toEqual({ sha256: parsed!.sha256, kind });
		}
	});
	test("accepts a short single-line change note or null", () => {
		expect(parseArtifactSave({ ...save, note: "Adjusted spacing" })?.note).toBe("Adjusted spacing");
		expect(parseArtifactSave({ ...save, note: "x".repeat(120) })?.note).toBe("x".repeat(120));
		for (const note of [undefined, "", " ", " padded ", "two\nlines", "x".repeat(121), 42]) expect(parseArtifactSave({ ...save, note })).toBeNull();
	});
	test("refuses unsafe file identities", () => {
		for (const file of ["", " ", "/a.html", "../a.html", "a/../b.html", "a//b.html", "a/./b.html", "a\\b.html", "C:/a.html", "a\0.html"]) expect(parseArtifactSave({ ...save, file })).toBeNull();
	});
	test("refuses malformed records", () => {
		for (const value of [null, [], {}, { ...save, kind: "pdf" }, { ...save, title: " " }, { ...save, bytes: 0 }, { ...save, bytes: -1 }, { ...save, bytes: 1.5 }, { ...save, bytes: Infinity }, { ...save, sha256: "A".repeat(64) }, { ...save, savedAt: undefined }, { ...save, savedAt: 0 }, { ...save, savedAt: 1.5 }, { ...save, savedAt: "2026-11-12" }]) expect(parseArtifactSave(value)).toBeNull();
	});
	test("refuses unbounded and malformed version names", () => {
		for (const raw of ["", `${save.sha256}.pdf`, `${save.sha256}.html/../x`, `${save.sha256}.html.extra`, `${"A".repeat(64)}.html`, `${"a".repeat(63)}.html`]) expect(parseVersionName(raw)).toBeNull();
	});
	test("a frame's image message opens only inline images, with a caption for each", () => {
		const png = "data:image/png;base64,AAAA";
		const message = { type: ARTIFACT_IMAGES_MESSAGE, images: [{ src: png, alt: " Hero " }, { src: png, alt: "" }], index: 1 };
		expect(parseArtifactImages(message)).toEqual({ images: [{ src: png, caption: "Hero" }, { src: png, caption: "Image" }], index: 1 });
		for (const bad of [{ ...message, type: "other" }, { ...message, index: 2 }, { ...message, index: -1 }, { ...message, images: [{ src: "https://attacker.example/x.png" }] }, { ...message, images: [{ src: "/api/media?path=/etc/hosts" }] }, null])
			expect(parseArtifactImages(bad)).toBeNull();
	});
});
