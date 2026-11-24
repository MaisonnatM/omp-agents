/** The prompt a new session gets when it starts on steps of a project's plan. */
import { type Project, type ProjectStep, stepNumbers } from "../../../src/shared/projects";

/** The prompt naming `picked`, steps of `project` in plan order, each with its number; a sub-step indents only under its own step when that is picked too. */
export function stepsPrompt(project: Project, picked: readonly ProjectStep[]): string {
	const numbers = stepNumbers(project.steps);
	const nested = picked.map(step => picked.some(each => each.id === step.parentId));
	const lines = picked.map((step, index) => `${nested[index] ? "   " : ""}- ${numbers.get(step.id)}. ${step.text}${step.done ? " (done)" : ""}`);
	const heads = nested.filter(under => !under).length;
	const intro = `Work on ${heads === 1 ? "this step" : "these steps"} of the plan of the project "${project.name}":`;
	return [intro, ...lines, "", "Tick each step with project_update as you finish it."].join("\n");
}
