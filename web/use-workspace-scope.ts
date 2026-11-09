import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prKey } from "../src/shared/github";
import type { PastSession, RosterHost } from "../src/shared/sessions";
import { type Space, type Spaces, spaces, type Workspace } from "../src/shared/workspaces";
import type { DashboardState } from "./dashboard-state";
import { pullRequestsStore } from "./reads";
import { discoverableSessions, listWorkspaces, sessionsIn, workspacesIn, workspaceSwitch } from "./sessions";
import { storeOrRemove, useStoredState } from "./stored-state";

/**
 * The workspace the sidebar and the Pull requests page are scoped to, by `cwd`; absent for all of the space's workspaces.
 * Named before workspaces were called so; kept so the saved choice survives.
 */
const WORKSPACE_KEY = "omp-agents.sidebar-project";

/** The space the last switch chose on this computer, which a new window opens in; absent for Work. */
const SPACE_KEY = "omp-agents.space";

const decodeWorkspace = (raw: string | null): string | null => raw;
const encodeWorkspace = (cwd: string | null): string => cwd ?? "";

/** The workspace `cwd` the sidebar and the Pull requests page show, `null` for all of the space's workspaces, and its setter, which localStorage keeps. */
function useSelectedWorkspace(workspaces: Workspace[]): [string | null, (cwd: string | null) => void] {
	const [stored, pick] = useStoredState(WORKSPACE_KEY, decodeWorkspace, encodeWorkspace);
	// A stored workspace with no sessions left, in the other space, or not yet loaded, shows all of the space's.
	return [workspaces.some(({ cwd }) => cwd === stored) ? stored : null, pick];
}

/**
 * The space this window shows, and its setter. It starts at the space localStorage keeps, but a window does not follow another's
 * switch, as `useStoredState` would, so each window switches on its own.
 */
function useSpace(): [Space, (space: Space) => void] {
	const [space, setSpace] = useState<Space>(() => (localStorage.getItem(SPACE_KEY) === "personal" ? "personal" : "work"));
	const pick = useCallback((next: Space): void => {
		storeOrRemove(SPACE_KEY, next, "work");
		setSpace(next);
	}, []);
	return [space, pick];
}

/** The directories the sidebar, the palette, and the pages list, and the space and workspace they are scoped to. */
export interface WorkspaceScope {
	/**
	 * The sessions of the space in neither a temporary nor a hidden directory, and no Bot's conversation, with the space's live Bot
	 * conversations apart, titled with their Bot's name. The raw lists keep the others for what links to them.
	 */
	visible: { hosts: RosterHost[]; past: PastSession[]; bots: RosterHost[] };
	/** {@link visible} of every space, which a switch of space picks the panes' session from. */
	everySpace: { hosts: RosterHost[]; past: PastSession[]; bots: RosterHost[] };
	hiddenCwds: ReadonlySet<string>;
	/** The space's workspaces, as {@link listWorkspaces} lists them, Personal's from the personal directory. */
	workspaces: Workspace[];
	/** Every space's workspaces, for what a workspace's space does not scope: Settings › Workspaces, Bots, scheduled sends, and Google accounts. */
	allWorkspaces: Workspace[];
	/** The workspace `cwd` the sidebar and the Pull requests page show, `null` for all of the space's workspaces. */
	workspace: string | null;
	pickWorkspace: (cwd: string | null) => void;
	/** The pull requests' scope, as {@link pullRequestsStore} keys it: the workspace, else the space. */
	pullRequestsScope: string;
	/** The space this window shows. */
	space: Space;
	pickSpace: (space: Space) => void;
	/** Which space each directory is in; `null` until the server names the personal directory, while everything counts as Work. */
	spaces: Spaces | null;
}

/**
 * The visible sessions, the workspaces they form, the space, and the selected workspace. It polls the pull requests of that workspace,
 * else of the space, which keeps the Pull requests tab's count current on every page, and follows a session this page starts into its workspace.
 */
export function useWorkspaceScope(state: DashboardState): WorkspaceScope {
	const [space, pickSpace] = useSpace();
	const { personal: personalDir } = state;
	const personalCwds = state.workspaceList.personal;
	const placement = useMemo(() => (personalDir ? spaces(personalCwds.map(({ cwd }) => cwd), personalDir) : null), [personalCwds, personalDir]);
	// Temporary and hidden workspaces, and Bots' conversations, remain in the raw sessions; only discoverable sessions enter the workspace list and sidebar view.
	const hiddenCwds = useMemo(() => new Set(state.workspaceList.hidden.map(hidden => hidden.cwd)), [state.workspaceList.hidden]);
	const botNames = useMemo(() => new Map((state.bots ?? []).flatMap(bot => (bot.sessionId === null ? [] : [[bot.sessionId, bot.name] as const]))), [state.bots]);
	const discoverable = useMemo(() => discoverableSessions(state.hosts, state.past, hiddenCwds, botNames), [state.hosts, state.past, hiddenCwds, botNames]);
	const visible = useMemo(() => sessionsIn(discoverable, space, placement), [discoverable, space, placement]);
	const allWorkspaces = useMemo(
		// A Personal workspace is offered even before a session runs there.
		() => listWorkspaces(discoverable.hosts, discoverable.past, [...state.workspaceList.added, ...personalCwds].filter(added => !hiddenCwds.has(added.cwd))),
		[discoverable, state.workspaceList.added, personalCwds, hiddenCwds],
	);
	const workspaces = useMemo(() => workspacesIn(allWorkspaces, space, placement, personalDir), [allWorkspaces, space, placement, personalDir]);
	const [workspace, pickWorkspace] = useSelectedWorkspace(workspaces);
	// Until the sessions are listed, the saved workspace reads as all of the space's.
	const pullRequestsScope = workspace ?? space;
	pullRequestsStore.usePolling(pullRequestsScope, state.listed);
	// A pull request that leaves the queue, merged by the server while the page waited, or cancelled, changes what GitHub lists before the next poll would show it; before the sessions are listed, the first poll reads it.
	const queued = useMemo(() => state.merges.flatMap(merge => merge.prs.map(prKey)), [state.merges]);
	const lastQueued = useRef(queued);
	useEffect(() => {
		const left = lastQueued.current.some(key => !queued.includes(key));
		lastQueued.current = queued;
		if (left && state.listed) void pullRequestsStore.refresh(pullRequestsScope, { fresh: true });
	}, [queued]);
	const { started } = state;
	useEffect(() => {
		if (!started) return;
		const next = workspaceSwitch(workspace, started.workspace, hiddenCwds);
		if (next !== null) pickWorkspace(next);
	}, [started]);
	return useMemo(
		() => ({ visible, everySpace: discoverable, hiddenCwds, workspaces, allWorkspaces, workspace, pickWorkspace, pullRequestsScope, space, pickSpace, spaces: placement }),
		[visible, discoverable, hiddenCwds, workspaces, allWorkspaces, workspace, pickWorkspace, pullRequestsScope, space, pickSpace, placement],
	);
}
