import { expect, test } from "bun:test";
import { absoluteFilePath, textFilePath } from "./file-paths";

test("a relative path resolves against its base, dot segments included", () => {
	expect(absoluteFilePath("../notes/plan.md", "/repo/docs")).toBe("/repo/notes/plan.md");
	expect(absoluteFilePath("./usage.md", "/repo/docs/")).toBe("/repo/docs/usage.md");
	expect(absoluteFilePath("~/plan.md", null)).toBe("~/plan.md");
	expect(absoluteFilePath("plan.md", null)).toBeNull();
});

test("a link names a text file only without a scheme, and loses its line suffix", () => {
	expect(textFilePath("/tmp/report.TSV:12-30")).toBe("/tmp/report.TSV");
	expect(textFilePath("https://example.com/readme.md")).toBeNull();
	expect(textFilePath("#readme.md")).toBeNull();
	expect(textFilePath("/tmp/report.pdf")).toBeNull();
});
