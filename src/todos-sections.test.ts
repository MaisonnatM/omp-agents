import { describe, expect, test } from "bun:test";
import { sectionFor } from "../templates/omp/agent/extensions/todos/sections";

const sections = [
	{ id: "omp", name: "omp" },
	{ id: "review", name: "To review" },
];

describe("sectionFor", () => {
	test("a section that does not exist resolves to none, naming the sections that exist", () => {
		expect(sectionFor(sections, "yampa")).toEqual({ categoryId: null, missing: 'No section named "yampa"; the sections are: omp, To review.' });
		expect(sectionFor(undefined, "yampa")).toEqual({ categoryId: null, missing: 'No section named "yampa"; the sections are: none.' });
	});

	test("a section name matches case-insensitively, and no name resolves to none", () => {
		expect(sectionFor(sections, "to REVIEW")).toEqual({ categoryId: "review" });
		expect(sectionFor(sections, undefined)).toEqual({ categoryId: null });
	});
});
