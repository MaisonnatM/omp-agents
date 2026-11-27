import { expect, test } from "bun:test";
import { parseGlossary } from "./glossary";

test("parseGlossary reads term blocks with their Avoid line and list-item terms, under their headings", () => {
	const text = [
		"# Repo",
		"",
		"Intro paragraph, not a term.",
		"",
		"- **Preview**: the private build of a pull request, at `/pr-<n>/`.",
		"",
		"## Sessions",
		"",
		"**Session**:",
		"One omp conversation.",
		"Kept in its session file.",
		"_Avoid_: Chat, thread, agent run",
		"",
		"**Goal:**",
		"An objective omp tracks.",
		"",
		"## Empty",
		"",
		"Just prose.",
	].join("\n");
	expect(parseGlossary(text)).toEqual([
		{ title: null, terms: [{ term: "Preview", definition: "the private build of a pull request, at `/pr-<n>/`.", avoid: [] }] },
		{
			title: "Sessions",
			terms: [
				{ term: "Session", definition: "One omp conversation.\nKept in its session file.", avoid: ["Chat", "thread", "agent run"] },
				{ term: "Goal", definition: "An objective omp tracks.", avoid: [] },
			],
		},
	]);
});
