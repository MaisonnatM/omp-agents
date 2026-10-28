import { describe, expect, test } from "bun:test";
import type { FoundFile } from "./discovery";
import { workflowsOf } from "./workflows";

const skill = (name: string, path: string, frontmatter: Record<string, unknown>): FoundFile => ({ kind: "skill", scope: "user", path, name, frontmatter });
const command = (name: string, scope: FoundFile["scope"], path: string): FoundFile => ({ kind: "command", scope, path, name });

describe("workflowsOf", () => {
	test("lists a skill whose metadata.tags names workflow, and leaves out one without it or with a top-level tags key", () => {
		const workflows = workflowsOf([
			skill("ship", "/u/skills/ship/SKILL.md", { description: "Ship a ticket", metadata: { tags: "review, workflow" } }),
			skill("plain", "/u/skills/plain/SKILL.md", { metadata: { tags: "workflows review" } }),
			skill("top", "/u/skills/top/SKILL.md", { tags: ["workflow"] }),
		]);
		expect(workflows).toEqual([{ name: "ship", description: "Ship a ticket", skill: "/u/skills/ship/SKILL.md", command: null }]);
	});

	test("pairs a workflow with the command omp names like it, the project's over the user's, whatever the file is called", () => {
		const workflows = workflowsOf([
			command("ship", "user", "/u/commands/ship.md"),
			skill("ship", "/u/skills/deliver/SKILL.md", { metadata: { tags: "workflow" } }),
			command("other", "project", "/p/.omp/commands/ship.md"),
			command("ship", "project", "/p/.omp/commands/go/ship.md"),
		]);
		expect(workflows).toEqual([{ name: "ship", description: "", skill: "/u/skills/deliver/SKILL.md", command: "/p/.omp/commands/go/ship.md" }]);
	});

	test("sorts workflows by name", () => {
		const workflows = workflowsOf([
			skill("triage", "/u/skills/triage/SKILL.md", { metadata: { tags: "workflow" } }),
			skill("audit", "/u/skills/audit/SKILL.md", { metadata: { tags: "ops workflow" } }),
		]);
		expect(workflows.map(({ name }) => name)).toEqual(["audit", "triage"]);
	});
});
