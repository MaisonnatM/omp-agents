import { memo } from "react";
import { newSessionRequest } from "../../src/shared/sessions";
import { botRows, type OpenBot } from "../bots-model";
import { NEW_DRAFT_KEY } from "../composer-drafts";
import type { DashboardState } from "../dashboard-state";
import { isModulePage } from "../modules";
import { useModulesOff } from "../modules-off";
import type { SplitAxis } from "../pane-navigation";
import type { Layout, Page } from "../routing";
import { hashForNewSession } from "../routing";
import type { SectionTarget } from "../section";
import type { StartOf } from "../starts";
import type { WorkspaceScope } from "../use-workspace-scope";
import { useDashboardActions } from "./dashboard-context";
import { EmptyHome } from "./empty-home";
import { ModuleOffPage } from "./module-off-page";
import { ModulePageView } from "./module-views";
import { PullRequestsPage } from "./pull-requests/pull-requests-page";
import { NewSession } from "./new-session";
import { NotificationsPage } from "./notices";

import { PaneGrid } from "./pane-grid";
import { BotsView } from "./bots/bots-view";
import { SettingsPage } from "./settings/settings-page";
import { ScheduledSession } from "./scheduled-session";
import { useScheduleSend } from "./scheduled";

/** The page state's fields the pages read, each the same object until it changes, so a socket update to any other field skips the page. */
type PageState = Pick<
	DashboardState,
	"hosts" | "past" | "lastHosts" | "layout" | "splits" | "models" | "modules" | "routines" | "bots" | "botLasts" | "workspaceList" | "trustedProjects" | "newSessionCompletions" | "connected" | "listed" | "rosterError" | "notices"
>;

interface PageSwitchProps extends PageState {
	/** The page covering the panes; `null` while the panes show. */
	page: Page | null;
	/** The Bot whose page is open, `null` on any other page, while the Bots load, or for a Bot that is gone. */
	openBot: OpenBot | null;
	/** The new session under way or failed, if there is one. */
	newStart: StartOf<"new"> | null;
	scope: WorkspaceScope;
	/** Where a new session starts when nothing picks a directory. */
	defaultWorkspace: string;
	/** The page section a sidebar link last chose. */
	sectionTarget: SectionTarget | null;
	maximized: boolean;
	/** The right sidebar shows the focused session's details. */
	hasDetails: boolean;
	rightOpen: boolean;
	show: (layout: Layout) => void;
	close: (index: number) => void;
	resize: (axis: SplitAxis, ratio: number) => void;
	toggleSidebar: (side: "right") => void;
}

/** The main area: the page the URL names, or the panes. */
export const PageSwitch = memo(function PageSwitch({
	page,
	hosts,
	past,
	lastHosts,
	layout,
	splits,
	models,
	modules,
	routines,
	bots,
	botLasts,
	openBot,
	workspaceList,
	trustedProjects,
	newSessionCompletions,
	connected,
	listed,
	rosterError,
	notices,
	newStart,
	scope,
	defaultWorkspace,
	sectionTarget,
	maximized,
	hasDetails,
	rightOpen,
	show,
	close,
	resize,
	toggleSidebar,
}: PageSwitchProps) {
	const { send, start, dismissStart } = useDashboardActions();
	const scheduleSend = useScheduleSend();
	const [modulesOff] = useModulesOff();
	const { visible, workspaces, workspace, pickWorkspace } = scope;
	if (page && isModulePage(page)) {
		if (modulesOff.has(page.kind)) return <ModuleOffPage page={page} />;
		const core = {
			routines,
			bots,
			botLasts,
			projects: modules.projects,
			listed,
			workspace,
			workspaces,
			onPickWorkspace: pickWorkspace,
			hosts: visible.hosts,
			models,
			sessions: { hosts, past },
			section: sectionTarget,
			newSessionCompletions,
			openBot,
			lastHosts,
			defaultWorkspace,
			connected,
			detailsOpen: rightOpen,
			onToggleDetails: () => toggleSidebar("right"),
		};
		return <ModulePageView page={page} states={modules} disabled={!connected} core={core} />;
	}
	switch (page?.kind) {
		case "new": {
			const cwd = page.cwd ?? defaultWorkspace;
			return (
				<NewSession
					cwd={cwd}
					workspaces={workspaces}
					launch={newStart}
					connected={connected}
					completions={newSessionCompletions}
					onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
					onPickCwd={next => {
						// A failed start's error is about the directory left behind.
						dismissStart("new");
						location.hash = hashForNewSession({ cwd: next, projectId: page.projectId });
					}}
					onStart={op => start({ kind: "new", cwd, ...op, projectId: page.projectId })}
					onSchedule={(op, when) => scheduleSend({ kind: "start", request: newSessionRequest(cwd, op.prompt, { ...op, projectId: page.projectId }) }, when)}
					projectId={page.projectId}
					onDropProject={() => {
						location.hash = hashForNewSession({ cwd: page.cwd });
					}}
					draftKey={NEW_DRAFT_KEY}
				/>
			);
		}
		case "scheduled":
			return <ScheduledSession id={page.id} workspaces={workspaces} connected={connected} completions={newSessionCompletions} />;
		case "settings":
			return (
				<SettingsPage section={page.section} cwd={workspace} workspaces={workspaces} scope={{ kind: "all", onPickWorkspace: pickWorkspace, workspaceList, trustedProjects }} />
			);
		case "pull-requests":
			return <PullRequestsPage hosts={visible.hosts} past={visible.past} route={page} />;
		case "bots":
			return (
				<BotsView
					route={page}
					rows={bots === null ? null : botRows(bots, hosts, botLasts)}
					routines={routines}
					open={openBot}
					bots={bots}
					past={past}
					lastHosts={lastHosts}
					models={models}
					workspaces={workspaces}
					defaultCwd={defaultWorkspace}
					connected={connected}
					detailsOpen={rightOpen}
					onToggleDetails={() => toggleSidebar("right")}
					completions={newSessionCompletions}
				/>
			);
		case "notifications":
			return <NotificationsPage notices={notices} />;
		// Get started is a dialog over the home, which `GetStarted` in `web/app.tsx` draws.
		case "get-started":
		case undefined:
			if (layout.panes.length > 0) {
				return (
					<PaneGrid
						layout={layout}
						hosts={hosts}
						past={past}
						lastHosts={lastHosts}
						models={models}
						workspaces={workspaces}
						maximized={maximized}
						hasDetails={hasDetails}
						rightOpen={rightOpen}
						show={show}
						close={close}
						ratios={splits.ratios}
						resize={resize}
						toggleSidebar={toggleSidebar}
					/>
				);
			}
			return <EmptyHome live={hosts.length > 0} rosterError={rosterError} />;
		default: {
			const never: never = page;
			return never;
		}
	}
});
