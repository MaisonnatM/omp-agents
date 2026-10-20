import { expect, test } from "bun:test";
import { absoluteFilePath, linkedFile } from "./file-paths";

test("a relative path resolves against its base, dot segments included", () => {
	expect(absoluteFilePath("../notes/plan.md", "/repo/docs")).toBe("/repo/notes/plan.md");
	expect(absoluteFilePath("./usage.md", "/repo/docs/")).toBe("/repo/docs/usage.md");
	expect(absoluteFilePath("~/plan.md", null)).toBe("~/plan.md");
	expect(absoluteFilePath("plan.md", null)).toBeNull();
});

test("a link names a file only without a scheme, and loses its line suffix", () => {
	expect(linkedFile("/tmp/report.TSV:12-30")).toEqual({ path: "/tmp/report.TSV", kind: "text" });
	expect(linkedFile("https://example.com/readme.md")).toBeNull();
	expect(linkedFile("#readme.md")).toBeNull();
	expect(linkedFile("/tmp/report.pdf")).toBeNull();
});

test("an image or video path is named by its kind, whatever its case", () => {
	expect(linkedFile("tmp/shot.PNG")).toEqual({ path: "tmp/shot.PNG", kind: "image" });
	expect(linkedFile("~/demo.mov")).toEqual({ path: "~/demo.mov", kind: "video" });
	expect(linkedFile("https://example.com/shot.png")).toBeNull();
});
