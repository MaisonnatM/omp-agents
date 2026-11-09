import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bot } from "../src/shared/bots";
import { prKey } from "../src/shared/github";
import type { ScheduledSend } from "../src/shared/scheduled";
import type { PastSession, RosterHost } from "../src/shared/sessions";
import { isSpace, type Space, spaces, type Workspace } from "../src/shared/workspaces";
import { botsIn } from "./bots-model";
import type { DashboardState } from "./dashboard-state";
import { pullRequestsScope as scopeOf, pullRequestsStore } from "./reads";
import { discoverableSessions, listWorkspaces, scheduledIn, sessionsIn, type WindowScope, workspacesIn, workspaceSwitch } from "./sessions";
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
	const [space, setSpace] = useState<Space>(() => {
		const stored = localStorage.getItem(SPACE_KEY);
		return isSpace(stored) ? stored : "work";
	});
	const pick = useCallback((next: Space): void => {
		storeOrRemove(SPACE_KEY, next, "work");
		setSpace(next);
	}, []);
	return [space, pick];
}

/** The directories the sidebar, the palette, and the pages list, and the space and workspace they are scoped to. */
export interface WorkspaceScope extends WindowScope {
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
	/** Every space's workspaces, for what a workspace's space does not scope: Settings › Workspaces, a Bot's settings, and a scheduled start's page. */
	allWorkspaces: Workspace[];
	/** The space's Bots, the sidebar's and the Bots page's; `null` until the server sends them. A Bot's address opens it from either space. */
	bots: Bot[] | null;
	/** The space's scheduled sends, the sidebar's; a send's page and its session's composer show it from either space. */
	scheduled: ScheduledSend[];
	pickWorkspace: (cwd: string | null) => void;
	/** The pull requests' scope, as {@link scopeOf} builds it from the workspace, else the space. */
	pullRequestsScope: string;
	pickSpace: (space: Space) => void;
}

/**
 * The visible sessions, the workspaces they form, the space, and the selected workspace. It polls the pull requests of that workspace,
 * else of the space, which keeps the Pull requests tab's count current on every page, and follows a session this page starts into its workspace.
 */
export function useWorkspaceScope(state: DashboardState): WorkspaceScope {
	const [space, pickSpace] = useSpace();
	const { personal: personalDir } = state;
	const personalCwds = state.workspaceList.personal;
	// A Bot or a scheduled start names its directory as the page shows it, `~` included, so a Personal workspace is listed both ways.
	const placement = useMemo(() => spaces(personalCwds.flatMap(({ cwd, cwdDisplay }) => [cwd, cwdDisplay]), personalDir), [personalCwds, personalDir]);
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
	const bots = useMemo(() => state.bots && botsIn(state.bots, space, placement), [state.bots, space, placement]);
	const scheduled = useMemo(() => scheduledIn(state.scheduled, space, { hosts: state.hosts, past: state.past }, placement), [state.scheduled, space, state.hosts, state.past, placement]);
	const [workspace, pickWorkspace] = useSelectedWorkspace(workspaces);
	// Until the sessions are listed, the saved workspace reads as all of the space's.
	const pullRequestsScope = scopeOf({ space, workspace });
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
	const home = space === "personal" ? personalDir : null;
	return useMemo(
		() => ({ visible, everySpace: discoverable, hiddenCwds, workspaces, allWorkspaces, bots, scheduled, workspace, pickWorkspace, pullRequestsScope, space, pickSpace, spaces: placement, home }),
		[visible, discoverable, hiddenCwds, workspaces, allWorkspaces, bots, scheduled, workspace, pickWorkspace, pullRequestsScope, space, pickSpace, placement, home],
	);
}
