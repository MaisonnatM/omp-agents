import { expect, test } from "bun:test";
import { absoluteFilePath, fileTarget, linkedFile, textFileUrl } from "./file-paths";

test("a relative path in a session's text keeps its session for the server's lookup; an absolute one, or a file's text, does not", () => {
	const session = { dir: "/code/app", session: "s1" };
	expect(fileTarget("zen/a.md", session)).toEqual({ path: "/code/app/zen/a.md", lookup: { session: "s1", relative: "zen/a.md" } });
	expect(fileTarget("~/notes/a.md", session)).toEqual({ path: "~/notes/a.md", lookup: null });
	expect(fileTarget("zen/a.md", { dir: "/notes", session: null })).toEqual({ path: "/notes/zen/a.md", lookup: null });
	expect(fileTarget("zen/a.md", null)).toBeNull();
	expect(textFileUrl({ path: "/code/app/zen/a.md", lookup: { session: "s1", relative: "zen/a.md" } })).toBe("/api/file?path=%2Fcode%2Fapp%2Fzen%2Fa.md&session=s1&relative=zen%2Fa.md");
});

test("a relative path resolves against its base, dot segments included", () => {
	expect(absoluteFilePath("../notes/plan.md", "/repo/docs")).toBe("/repo/notes/plan.md");
	expect(absoluteFilePath("./usage.md", "/repo/docs/")).toBe("/repo/docs/usage.md");
	expect(absoluteFilePath("~/plan.md", null)).toBe("~/plan.md");
	expect(absoluteFilePath("../docs/plan.md", "~/.omp/agent/skills")).toBe("~/.omp/agent/docs/plan.md");
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
