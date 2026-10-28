/** Workflows: the skills whose frontmatter tags them `workflow`, each with the slash command of the same name that starts it. */
import { basename, dirname } from "node:path";
import { isObject } from "../json";
import type { OmpFile, Workflow } from "../shared/models";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** A skill file's frontmatter fields; `null` when it has none or its YAML is broken. */
function frontmatter(text: string): Record<string, unknown> | null {
	const front = FRONTMATTER.exec(text);
	if (!front) return null;
	try {
		const parsed: unknown = Bun.YAML.parse(front[1] ?? "");
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The workflow skills among `files`, by name. The tag lives in `metadata.tags`, a comma- or space-separated string,
 * because omp's plugin loader accepts no other frontmatter key and only string values under `metadata`.
 */
export function workflowsOf(files: OmpFile[]): Workflow[] {
	const commands = files.filter(file => file.kind === "command").toSorted((a, b) => (a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1));
	return files
		.flatMap((skill): Workflow[] => {
			if (skill.kind !== "skill" || skill.body.state !== "read") return [];
			const fields = frontmatter(skill.body.text);
			const tags = fields && isObject(fields.metadata) ? fields.metadata.tags : undefined;
			if (typeof tags !== "string" || !tags.split(/[\s,]+/).includes("workflow")) return [];
			const name = typeof fields?.name === "string" ? fields.name : basename(dirname(skill.path));
			return [
				{
					name,
					description: typeof fields?.description === "string" ? fields.description : "",
					skill,
					command: commands.find(command => basename(command.path) === `${name}.md`) ?? null,
				},
			];
		})
		.toSorted((a, b) => a.name.localeCompare(b.name));
}
