import { expect, test } from "bun:test";
import type { Project } from "../../../src/shared/projects";
import { stepsPrompt } from "./steps-prompt";

const project: Project = {
	id: "p1",
	name: "Launch",
	goal: "",
	steps: [
		{ id: "s1", text: "Write the landing page", done: false },
		{ id: "s1a", text: "Hero copy", done: false, parentId: "s1" },
		{ id: "s1b", text: "Pricing table", done: true, parentId: "s1" },
		{ id: "s2", text: "Announce it", done: false },
	],
	decisions: [],
	log: [],
	sessionIds: [],
	createdAt: "2026-11-24T10:00:00.000Z",
};
const TAIL = "\n\nTick each step with project_update as you finish it.";

test("a step with its sub-steps reads as one step, sub-steps indented and done ones marked", () => {
	expect(stepsPrompt(project, new Set(["s1b", "s1", "s1a"]))).toBe(
		`Work on this step of the plan of the project "Launch":\n- 1. Write the landing page\n   - 1.1. Hero copy\n   - 1.2. Pricing table (done)${TAIL}`,
	);
});

test("a sub-step picked without its step stands unindented", () => {
	expect(stepsPrompt(project, new Set(["s1a"]))).toBe(`Work on this step of the plan of the project "Launch":\n- 1.1. Hero copy${TAIL}`);
});

test("several steps read as these steps, in plan order", () => {
	expect(stepsPrompt(project, new Set(["s2", "s1a"]))).toBe(`Work on these steps of the plan of the project "Launch":\n- 1.1. Hero copy\n- 2. Announce it${TAIL}`);
});

test("ids of removed steps make no prompt", () => {
	expect(stepsPrompt(project, new Set(["gone"]))).toBeNull();
});
