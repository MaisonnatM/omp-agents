import { describe, expect, test } from "bun:test";
import type { OmpFile } from "../shared/models";
import { workflowsOf } from "./workflows";

const file = (kind: OmpFile["kind"], scope: OmpFile["scope"], path: string, text: string): OmpFile => ({
	kind,
	scope,
	path,
	pathDisplay: path,
	body: { state: "read", size: text.length, modifiedAt: 0, text, hash: "" },
});

describe("workflowsOf", () => {
	test("keeps a skill whose metadata.tags lists workflow among other tags, paired with its command, project over user", () => {
		const skill = file("skill", "user", "/u/skills/ship/SKILL.md", "---\nname: ship\ndescription: Ship a ticket\nmetadata:\n  tags: review, workflow\n---\n\nSteps.\n");
		const userCommand = file("command", "user", "/u/commands/ship.md", "user");
		const projectCommand = file("command", "project", "/p/.omp/commands/ship.md", "project");
		const other = file("command", "project", "/p/.omp/commands/other.md", "other");
		const workflows = workflowsOf([userCommand, skill, other, projectCommand]);
		expect(workflows.map(({ name, description, skill, command }) => ({ name, description, skill: skill.path, command: command?.path ?? null }))).toEqual([
			{ name: "ship", description: "Ship a ticket", skill: "/u/skills/ship/SKILL.md", command: "/p/.omp/commands/ship.md" },
		]);
	});

	test("names a workflow by its directory without a name field, with no command when none matches, sorted by name", () => {
		const workflows = workflowsOf([
			file("skill", "project", "/p/.omp/skills/triage/SKILL.md", "---\ndescription: Triage\nmetadata:\n  tags: workflow\n---\n"),
			file("skill", "user", "/u/skills/audit/SKILL.md", "---\nname: audit\nmetadata:\n  tags: workflow ops\n---\n"),
		]);
		expect(workflows.map(({ name, description, command }) => ({ name, description, command }))).toEqual([
			{ name: "audit", description: "", command: null },
			{ name: "triage", description: "Triage", command: null },
		]);
	});

	test("leaves out skills without the tag, with a top-level tags key, with broken YAML, or not read", () => {
		const workflows = workflowsOf([
			file("skill", "user", "/u/skills/plain/SKILL.md", "---\nname: plain\nmetadata:\n  tags: workflows, review\n---\n"),
			file("skill", "user", "/u/skills/top/SKILL.md", "---\nname: top\ntags:\n  - workflow\n---\n"),
			file("skill", "user", "/u/skills/broken/SKILL.md", "---\nname: broken\nmetadata: [workflow\n---\n"),
			file("skill", "user", "/u/skills/bare/SKILL.md", "metadata:\n  tags: workflow\n"),
			{ kind: "skill", scope: "user", path: "/u/skills/gone/SKILL.md", pathDisplay: "/u/skills/gone/SKILL.md", body: { state: "missing" } },
			file("rule", "user", "/u/rules/flow.md", "---\nmetadata:\n  tags: workflow\n---\n"),
		]);
		expect(workflows).toEqual([]);
	});
});
