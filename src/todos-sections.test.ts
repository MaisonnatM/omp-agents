import { describe, expect, test } from "bun:test";
import { addSection, sectionNamed } from "../templates/omp/agent/extensions/todos/sections";

const sections = [
	{ id: "omp", name: "omp" },
	{ id: "review", name: "To review" },
];

describe("user_todo sections", () => {
	test("an add naming a section that does not exist files the todo in none, and says which sections exist", () => {
		expect(addSection(sections, "yampa")).toEqual({ categoryId: null, note: ' It is in no section. No section named "yampa"; the sections are: omp, To review.' });
		expect(addSection(undefined, "yampa")).toEqual({ categoryId: null, note: ' It is in no section. No section named "yampa"; the sections are: none.' });
	});

	test("an add files the todo in the section it names, matched case-insensitively, or in none when it names none", () => {
		expect(addSection(sections, "to REVIEW")).toEqual({ categoryId: "review", note: "" });
		expect(addSection(sections, undefined)).toEqual({ categoryId: null, note: "" });
	});

	test("an edit's lookup still refuses a section that does not exist", () => {
		expect(sectionNamed(sections, "yampa")).toEqual({ error: 'No section named "yampa"; the sections are: omp, To review.' });
	});
});
