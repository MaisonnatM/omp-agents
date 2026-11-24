/**
 * The changes omp's `project_update` leaves for the projects, one JSON file per call in a directory, so the server stays
 * the only writer of the project list and a session can change any project while the dashboard is down. An agent may
 * make every change the Projects page makes; a malformed change, or one the list refuses, is set aside whole with the
 * reason, and a file is deleted only once `apply` says its change reached the list's file.
 */
import { type ProjectChange, parseProjectChange } from "../shared/projects";
import { type InboxOptions, JsonInboxDir } from "./json-inbox";

export class ProjectsInbox extends JsonInboxDir<ProjectChange> {
	constructor(dir: string, apply: (change: ProjectChange) => boolean, options?: InboxOptions) {
		super(
			dir,
			{
				parse(_name, value) {
					const change = parseProjectChange(value);
					return "ok" in change ? { item: change.ok } : { invalid: change.error };
				},
				apply,
			},
			options,
		);
	}
}
