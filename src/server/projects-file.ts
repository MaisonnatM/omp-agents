/** The projects, kept in one file the server alone writes, so the page, the roster, and every session's brief read the same state. */
import { ReducerFile } from "../fs";
import { applyProjectChange, EMPTY_PROJECTS, parseProjectList, type ProjectChange, type ProjectList } from "../shared/projects";

/** `list` after `change`; a refused change throws and changes nothing. */
function applyOrThrow(list: ProjectList, change: ProjectChange): ProjectList {
	const applied = applyProjectChange(list, change);
	if ("error" in applied) throw new Error(applied.error);
	return applied.ok;
}

export class ProjectsFile extends ReducerFile<ProjectList, [ProjectChange]> {
	constructor(path: string) {
		super(path, { parse: parseProjectList, holds: "a project list", empty: EMPTY_PROJECTS, reduce: applyOrThrow });
	}
}
