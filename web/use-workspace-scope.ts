import { useEffect, useMemo, useRef } from "react";
import { prKey } from "../src/shared/github";
import type { PastSession, RosterHost } from "../src/shared/sessions";
import type { Workspace } from "../src/shared/workspaces";
import type { DashboardState } from "./dashboard-state";
import { pullRequestsStore } from "./reads";
import { discoverableSessions, listWorkspaces, workspaceSwitch } from "./sessions";
import { useStoredState } from "./stored-state";

/**
 * The workspace the sidebar and the Pull requests page are scoped to, by `cwd`; absent for all workspaces.
 * Named before workspaces were called so; kept so the saved choice survives.
 */
const WORKSPACE_KEY = "omp-agents.sidebar-project";

const decodeWorkspace = (raw: string | null): string | null => raw;
const encodeWorkspace = (cwd: string | null): string => cwd ?? "";

/** The workspace `cwd` the sidebar and the Pull requests page show, `null` for all workspaces, and its setter, which localStorage keeps. */
function useSelectedWorkspace(workspaces: Workspace[]): [string | null, (cwd: string | null) => void] {
	const [stored, pick] = useStoredState(WORKSPACE_KEY, decodeWorkspace, encodeWorkspace);
	// A stored workspace with no sessions left, or not yet loaded, shows all of them.
	return [workspaces.some(({ cwd }) => cwd === stored) ? stored : null, pick];
}

/** The directories the sidebar, the palette, and the pages list, and the workspace they are scoped to. */
export interface WorkspaceScope {
	/** The sessions in neither a temporary nor a hidden directory, and no Bot's conversation. The raw lists keep the others for what links to them. */
	visible: { hosts: RosterHost[]; past: PastSession[] };
	hiddenCwds: ReadonlySet<string>;
	/** The workspaces, as {@link listWorkspaces} lists them. */
	workspaces: Workspace[];
	/** The workspace `cwd` the sidebar and the Pull requests page show, `null` for all workspaces. */
	workspace: string | null;
	pickWorkspace: (cwd: string | null) => void;
}

/**
 * The visible sessions, the workspaces they form, and the selected workspace. It polls that workspace's pull requests, which keeps the
 * Pull requests tab's count current on every page, and follows a session this page starts into its workspace.
 */
export function useWorkspaceScope(state: DashboardState): WorkspaceScope {
	// Temporary and hidden workspaces, and Bots' conversations, remain in the raw sessions; only discoverable sessions enter the workspace list and sidebar view.
	const hiddenCwds = useMemo(() => new Set(state.workspaceList.hidden.map(hidden => hidden.cwd)), [state.workspaceList.hidden]);
	const botSessions = useMemo(() => new Set((state.bots ?? []).flatMap(bot => (bot.sessionId === null ? [] : [bot.sessionId]))), [state.bots]);
	const visible = useMemo(() => discoverableSessions(state.hosts, state.past, hiddenCwds, botSessions), [state.hosts, state.past, hiddenCwds, botSessions]);
	const workspaces = useMemo(
		() => listWorkspaces(visible.hosts, visible.past, state.workspaceList.added.filter(added => !hiddenCwds.has(added.cwd))),
		[visible, state.workspaceList.added, hiddenCwds],
	);
	const [workspace, pickWorkspace] = useSelectedWorkspace(workspaces);
	// Until the sessions are listed, the saved workspace reads as all workspaces.
	pullRequestsStore.usePolling(workspace, state.listed);
	// A pull request that leaves the queue, merged by the server while the page waited, or cancelled, changes what GitHub lists before the next poll would show it; before the sessions are listed, the first poll reads it.
	const queued = useMemo(() => state.merges.flatMap(merge => merge.prs.map(prKey)), [state.merges]);
	const lastQueued = useRef(queued);
	useEffect(() => {
		const left = lastQueued.current.some(key => !queued.includes(key));
		lastQueued.current = queued;
		if (left && state.listed) void pullRequestsStore.refresh(workspace, { fresh: true });
	}, [queued]);
	const { started } = state;
	useEffect(() => {
		if (!started) return;
		const next = workspaceSwitch(workspace, started.workspace, hiddenCwds);
		if (next !== null) pickWorkspace(next);
	}, [started]);
	return useMemo(() => ({ visible, hiddenCwds, workspaces, workspace, pickWorkspace }), [visible, hiddenCwds, workspaces, workspace, pickWorkspace]);
}
