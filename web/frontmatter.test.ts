import { expect, test } from "bun:test";
import { descriptionOf, splitFrontmatter } from "./frontmatter";

test("frontmatter splits into its keys, each value as text, and the Markdown after it", () => {
	const text = [
		"---",
		"name: ship",
		`description: "Use for \\"ship it\\", or 'land'."`,
		"title: 'It''s here'",
		"metadata:",
		"  tags: workflow",
		"  owner: maxence",
		"tools:",
		"- read",
		"- bash",
		"summary: >",
		"  one",
		"  two",
		"steps: |",
		"  first",
		"  second",
		"long: runs on",
		"  over two lines",
		"empty:",
		"---",
		"",
		"# Ship",
	].join("\n");
	expect(splitFrontmatter(text)).toEqual({
		fields: [
			{ key: "name", value: "ship" },
			{ key: "description", value: `Use for "ship it", or 'land'.` },
			{ key: "title", value: "It's here" },
			{ key: "metadata", value: "tags: workflow\nowner: maxence" },
			{ key: "tools", value: "- read\n- bash" },
			{ key: "summary", value: "one two" },
			{ key: "steps", value: "first\nsecond" },
			{ key: "long", value: "runs on over two lines" },
			{ key: "empty", value: "" },
		],
		body: "# Ship",
	});
});

test("text without a closed frontmatter block, or with a line no key starts, keeps its whole text", () => {
	for (const text of ["# Title\n\nname: x", "---\nname: x\n\n# never closed", "---\nname: x\nnot a key\n---\nbody", "--- \nname: x\n---\nbody"]) {
		expect(splitFrontmatter(text)).toEqual({ fields: [], body: text });
	}
});

test("a description reads from the frontmatter only", () => {
	expect(descriptionOf("---\nname: a\ndescription: Does a thing\n---\nbody")).toBe("Does a thing");
	expect(descriptionOf("---\nname: a\n---\ndescription: not this")).toBeNull();
	expect(descriptionOf("---\ndescription:\n---\n")).toBeNull();
});
