/** Workflows: the skills whose frontmatter tags them `workflow`, each with the slash command of the same name that starts it. */
import { isObject } from "../json";
import type { Workflow } from "../shared/models";
import type { FoundFile } from "./discovery";

/**
 * The workflow skills among `found`, by name. The tag lives in `metadata.tags`, a comma- or space-separated string,
 * because omp's plugin loader accepts no other frontmatter key and only string values under `metadata`.
 */
export function workflowsOf(found: FoundFile[]): Workflow[] {
	const commands = found.filter(file => file.kind === "command").toSorted((a, b) => (a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1));
	return found
		.flatMap(({ kind, name, frontmatter, path }): Workflow[] => {
			const metadata = frontmatter?.metadata;
			const tags = isObject(metadata) ? metadata.tags : undefined;
			if (kind !== "skill" || name === undefined || typeof tags !== "string" || !tags.split(/[\s,]+/).includes("workflow")) return [];
			const description = frontmatter?.description;
			return [
				{
					name,
					description: typeof description === "string" ? description : "",
					skill: path,
					command: commands.find(command => command.name === name)?.path ?? null,
				},
			];
		})
		.toSorted((a, b) => a.name.localeCompare(b.name));
}
