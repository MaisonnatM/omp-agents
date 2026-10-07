/** The directories Settings → Projects added and hid, saved in `projects.json`. */
import { JsonFile } from "../fs";
import { isObject } from "../json";
import { applyProject, NO_PROJECTS, type ProjectChange, type ProjectList } from "../shared/projects";

const isPaths = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string" && entry.startsWith("/"));

export function parseProjects(value: unknown): ProjectList | null {
	if (!isObject(value) || !isPaths(value.added) || !isPaths(value.hidden)) return null;
	return { added: value.added, hidden: value.hidden };
}

export class ProjectsFile {
	readonly #file: JsonFile<ProjectList>;
	#list: ProjectList;

	constructor(path: string) {
		// Someone may have edited the file by hand, so one that holds something else moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseProjects, holds: "a project list", onInvalid: "aside", indent: "\t" });
		this.#list = this.#file.load() ?? NO_PROJECTS;
	}

	get list(): ProjectList {
		return this.#list;
	}

	/** Applies `change` and saves; whether it changed anything. */
	apply(change: ProjectChange): boolean {
		const next = applyProject(this.#list, change);
		if (next === this.#list) return false;
		this.#list = next;
		this.#file.save(next);
		return true;
	}
}
