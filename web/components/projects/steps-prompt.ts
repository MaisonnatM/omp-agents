/** The prompt a new session gets when it starts on steps of a project's plan. */
import { type Project, stepNumbers } from "../../../src/shared/projects";

/**
 * The prompt naming the steps of `project` whose ids `stepIds` holds, in plan order, each with its number, a sub-step
 * indented when its step is named too; `null` when it holds none of the project's steps, such as only removed ones.
 */
export function stepsPrompt(project: Project, stepIds: ReadonlySet<string>): string | null {
	const picked = project.steps.filter(step => stepIds.has(step.id));
	if (picked.length === 0) return null;
	const numbers = stepNumbers(project.steps);
	const nested = (parentId: string | undefined): boolean => parentId !== undefined && stepIds.has(parentId);
	const lines = picked.map(step => `${nested(step.parentId) ? "   " : ""}- ${numbers.get(step.id)}. ${step.text}${step.done ? " (done)" : ""}`);
	const intro = `Work on ${picked.filter(step => !nested(step.parentId)).length === 1 ? "this step" : "these steps"} of the plan of the project "${project.name}":`;
	return [intro, ...lines, "", "Tick each step with project_update as you finish it."].join("\n");
}
