/** The Projects module's server half: the project list and the inbox the starter kit's `project_update` leaves changes in. See docs/architecture/projects.md. */
import { join } from "node:path";
import type { StoredModule } from "./modules";
import { configDir } from "./paths";
import { migrateBoardProjects } from "./server/project-migration";
import { ProjectsFile } from "./server/projects-file";
import { ProjectsInbox } from "./server/projects-inbox";
import { parseProjectChange, type ProjectChange, type ProjectList } from "./shared/projects";

/** The projects; not `projects.json`, which an older version kept the workspaces in and the server still moves at startup. */
const PROJECTS_FILE = join(configDir, "project-list.json");
/** Where the starter kit's project tools leave their changes, one JSON file each, so the server stays the only writer of {@link PROJECTS_FILE}. */
const PROJECTS_INBOX = join(configDir, "project-inbox");
/** Where an older version kept its Board, whose project channels the projects take in once before it is renamed `board.json.removed`. */
const OLD_BOARD_FILE = join(configDir, "board.json");

export const PROJECTS_MODULE: StoredModule<"projects", ProjectList, ProjectChange> = {
	id: "projects",
	store: {
		open() {
			const file = new ProjectsFile(PROJECTS_FILE);
			migrateBoardProjects(file, OLD_BOARD_FILE);
			return file;
		},
		parse(value) {
			const change = parseProjectChange(value);
			return "ok" in change ? change.ok : null;
		},
		inbox: (_state, apply, options) => new ProjectsInbox(PROJECTS_INBOX, apply, options),
	},
};
