import { expect, test } from "bun:test";
import { frontmatterOf } from "./frontmatter";

test("a Markdown file's frontmatter gives its keys, each value as text, and where the Markdown after it starts", () => {
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
		"count: 3",
		"empty:",
		"---",
		"",
		"# Ship",
	].join("\n");
	const front = frontmatterOf("/skills/ship/SKILL.md", text);
	expect(front?.fields).toEqual([
		{ key: "name", value: "ship" },
		{ key: "description", value: `Use for "ship it", or 'land'.` },
		{ key: "title", value: "It's here" },
		{ key: "metadata", value: "tags: workflow\nowner: maxence" },
		{ key: "tools", value: "- read\n- bash" },
		{ key: "summary", value: "one two" },
		{ key: "steps", value: "first\nsecond" },
		{ key: "count", value: "3" },
		{ key: "empty", value: "" },
	]);
	expect(text.slice(front?.end)).toBe("# Ship");
});

test("no frontmatter for a block left open, broken YAML, YAML that is not a mapping, or a file that is not Markdown", () => {
	for (const text of ["# Title\n\nname: x", "---\nname: x\n\n# never closed", "---\nname: [x\n---\nbody", "---\n- a\n- b\n---\nbody"]) {
		expect(frontmatterOf("a.md", text)).toBeUndefined();
	}
	expect(frontmatterOf("config.yml", "---\nname: x\n---\n")).toBeUndefined();
});
