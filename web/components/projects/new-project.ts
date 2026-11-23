import { type BoardState, channelName } from "../../../src/shared/board";
import { hashForProject } from "../../routing";
import type { DashboardActions } from "../dashboard-context";

/** The project {@link createProject} made last, until its page takes it to select its name. */
let justCreated: string | null = null;

/** Creates a project channel named `new-project` and opens its page, whose name field {@link takeJustCreated} selects for you to type over. */
export function createProject(changeModule: DashboardActions["changeModule"], board: BoardState): void {
	const id = crypto.randomUUID();
	justCreated = id;
	void changeModule("board", { op: "channel", channel: { id, name: channelName(board, "new project"), about: "", project: { goal: "", decisions: [], sessionIds: [], createdAt: Date.now() } } });
	location.hash = hashForProject(id);
}

/** Whether project `id` is the one {@link createProject} just made; true once, for the page that opens it. */
export function takeJustCreated(id: string): boolean {
	if (id !== justCreated) return false;
	justCreated = null;
	return true;
}
