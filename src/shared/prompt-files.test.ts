import { describe, expect, test } from "bun:test";
import { plainText, promptLabel, splitFiles, withFiles } from "./prompt-files";

describe("withFiles and splitFiles", () => {
	test("files follow the text and split back off by name, each file's text kept out of the typed text", () => {
		const prompt = withFiles("compare these", [{ name: "a.md", text: "# A\n\n<file name=\"x\">" }, { name: "b.txt", text: "" }]);
		expect(prompt.startsWith("compare these\n\n<file name=\"a.md\">\n# A")).toBe(true);
		expect(splitFiles(prompt)).toEqual({ text: "compare these", files: ["a.md", "b.txt"] });
	});

	test("a prompt of files alone has empty text, and a skill command stays first", () => {
		expect(splitFiles(withFiles("", [{ name: "log.txt", text: "boom" }]))).toEqual({ text: "", files: ["log.txt"] });
		expect(splitFiles(withFiles("/skill:review check", [{ name: "diff.txt", text: "-a\n+b" }]))).toEqual({ text: "/skill:review check", files: ["diff.txt"] });
	});

	test("a quote or newline in a name cannot break the block it heads", () => {
		expect(splitFiles(withFiles("x", [{ name: 'say "hi"\n.md', text: "t" }])).files).toEqual(["say _hi__.md"]);
	});

	test("typed text that only looks like a file block stays text", () => {
		const typed = 'see <file name="a.md">\nbody\n</file>';
		expect(splitFiles(typed)).toEqual({ text: typed, files: [] });
		expect(splitFiles("plain prompt")).toEqual({ text: "plain prompt", files: [] });
	});

	test("a list shows the typed text, else the file names", () => {
		expect(promptLabel(withFiles("why?", [{ name: "a.md", text: "a" }]))).toBe("why?");
		expect(promptLabel(withFiles("", [{ name: "a.md", text: "a" }, { name: "b.md", text: "b" }]))).toBe("a.md, b.md");
	});
});

describe("plainText", () => {
	const encoder = new TextEncoder();

	test("reads UTF-8 text, accents and an empty file included", () => {
		expect(plainText(encoder.encode("# Spécifications\n"))).toBe("# Spécifications\n");
		expect(plainText(new Uint8Array())).toBe("");
	});

	test("refuses bytes with a NUL, invalid UTF-8, or a PDF's header", () => {
		expect(plainText(new Uint8Array([0x68, 0x00, 0x69]))).toBeNull();
		expect(plainText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
		expect(plainText(encoder.encode("%PDF-1.7\n%ascii only"))).toBeNull();
	});
});
