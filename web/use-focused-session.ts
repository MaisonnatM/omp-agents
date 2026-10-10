import { useEffect, useRef } from "react";
import type { PastSession, RosterHost, View } from "../src/shared/sessions";
import type { DashboardState } from "./dashboard-state";
import { documentTitle } from "./document-title";
import { focusedView, type Page } from "./routing";
import { workspaceSwitch } from "./sessions";
import type { WorkspaceScope } from "./use-workspace-scope";

/** The session the focused pane shows, as the sidebar, the title, and the details read it. */
export interface FocusedSession {
	view: View | null;
	/** The view's roster row; `undefined` for a past session, an ended one, or no view. */
	host: RosterHost | undefined;
	/** The view's past entry; `undefined` for a live session. */
	past: PastSession | undefined;
	/** An ended live session's last roster row, for the header after it left the roster. */
	lastHost: RosterHost | null;
	/** The session the view belongs to, whose changes page the Files tab links to; `null` for a subagent's view and for a live session not yet in the roster. */
	sessionId: string | null;
	/** The view's roster row, an ended session's last one, or its past entry: what the PRs tab lists. */
	row: RosterHost | PastSession | undefined;
	/** The directory the view's session runs or ran in. */
	cwd: string | undefined;
	/** The directory the session works in: its worktree, else its directory; `null` without a session. */
	workDir: string | null;
}

/**
 * The focused pane's session. It keeps the document title on it, and when a `/move` takes a live session to another
 * workspace, the sidebar follows it there.
 */
export function useFocusedSession(state: DashboardState, page: Page | null, { workspace, hiddenCwds, pickWorkspace }: WorkspaceScope): FocusedSession {
	const view = focusedView(state.layout);
	const host = view?.kind === "live" ? state.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const past = view?.kind === "past" ? state.past.find(s => s.sessionId === view.sessionId) : undefined;
	const lastHost = view?.kind === "live" ? state.lastHosts.get(view.instanceId) ?? null : null;
	const title = documentTitle(page ?? null, view, host ?? lastHost, past ?? null, state.projects);
	useEffect(() => {
		document.title = title;
	}, [title]);
	const shown = useRef<{ instanceId: string; cwd: string; workspace: string | null } | null>(null);
	// The workspace is the one shown before the move: the old directory may have no session left, which already shows all workspaces.
	useEffect(() => {
		const last = shown.current;
		shown.current = host ? { instanceId: host.instanceId, cwd: host.cwd, workspace } : null;
		if (!host || last?.instanceId !== host.instanceId || last.cwd === host.cwd) return;
		const next = workspaceSwitch(last.workspace, host.cwd, hiddenCwds);
		if (next !== null) pickWorkspace(next);
	}, [host?.instanceId, host?.cwd, workspace]);
	const session = host ?? past;
	const sessionId = view?.kind === "past" ? view.sessionId : view?.kind === "live" && view.agentId === null ? ((host ?? lastHost)?.sessionId ?? null) : null;
	return { view, host, past, lastHost, sessionId, row: host ?? lastHost ?? past, cwd: session?.cwd, workDir: session ? (session.worktree ?? session.cwd) : null };
}
