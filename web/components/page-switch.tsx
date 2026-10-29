import { memo } from "react";
import type { McpIntegration } from "../../src/shared/accounts";
import { newSessionRequest } from "../../src/shared/sessions";
import type { UserTodoList } from "../../src/user-todos-shared";
import { botRows, type OpenBot } from "../bots-model";
import { newDraftKey } from "../composer-drafts";
import type { DashboardState } from "../dashboard-state";
import type { SplitAxis } from "../pane-navigation";
import type { Layout, Page, TodoListView } from "../routing";
import { hashForNewSession } from "../routing";
import type { SectionTarget } from "../section";
import type { StartOf } from "../starts";
import type { WorkspaceScope } from "../use-workspace-scope";
import { CalendarPage } from "./calendar/calendar-page";
import { useDashboardActions } from "./dashboard-context";
import { EmailPage } from "./email/email-page";
import { EmptyHome } from "./get-started";
import { DisconnectedPage } from "./integrations/disconnected-page";
import { PullRequestsPage } from "./pull-requests/pull-requests-page";
import { NewSession } from "./new-session";
import { NewSessionBoard } from "./new-session-board";
import { PaneGrid } from "./pane-grid";
import { NotesPage } from "./notes/page";
import { BotPage, NewBot } from "./bots/bot-page";
import { BotsGallery } from "./bots/bots-gallery";
import { SettingsPage } from "./settings/settings-page";
import { ScheduledSession } from "./scheduled-session";
import { useScheduleSend } from "./scheduled";
import { TICKETS_META, TICKETS_TITLE, TicketsPage } from "./tickets/tickets-page";
import { TodoPage } from "./todo/page";

/** What a new session for top-level todo `todoId` starts with: its title, then its notes. `null` while the list names no such todo. */
function todoSeed(list: UserTodoList | null, todoId: string | null): { text: string; prompt: string } | null {
	const todo = todoId === null ? undefined : list?.todos.find(({ id }) => id === todoId);
	if (!todo) return null;
	const body = todo.body.trim();
	return { text: todo.text, prompt: body ? `${todo.text}\n\n${body}` : todo.text };
}

/** The page state's fields the pages read, each the same object until it changes, so a socket update to any other field skips the page. */
type PageState = Pick<
	DashboardState,
	"hosts" | "past" | "lastHosts" | "layout" | "splits" | "models" | "userTodos" | "userNotes" | "routines" | "bots" | "botLasts" | "workspaceList" | "pins" | "newSessionCompletions" | "connected" | "listed" | "rosterError"
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
	/** The tickets section a sidebar link last chose. */
	sectionTarget: SectionTarget | null;
	todoView: TodoListView;
	linear: McpIntegration | null;
	/** The dashboard reads and writes Linear. */
	linearCallable: boolean;
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
	userTodos,
	userNotes,
	routines,
	bots,
	botLasts,
	openBot,
	workspaceList,
	pins,
	newSessionCompletions,
	connected,
	listed,
	rosterError,
	newStart,
	scope,
	defaultWorkspace,
	sectionTarget,
	todoView,
	linear,
	linearCallable,
	maximized,
	hasDetails,
	rightOpen,
	show,
	close,
	resize,
	toggleSidebar,
}: PageSwitchProps) {
	const { send, start, dismissStart, changeTodo, changeNote } = useDashboardActions();
	const scheduleSend = useScheduleSend();
	const { visible, workspaces, workspace, pickWorkspace } = scope;
	switch (page?.kind) {
		case "new": {
			const cwd = page.cwd ?? defaultWorkspace;
			const seed = todoSeed(userTodos, page.todoId);
			// Until the todo list arrives, a todo's draft is neither the plain draft nor kept, so it cannot overwrite either.
			const pending = page.todoId !== null && userTodos === null;
			return (
				<NewSession
					// A todo's title and notes start the draft, so the draft mounts anew once the list names it.
					key={pending ? `pending:${page.todoId}` : seed ? `todo:${page.todoId}` : "new"}
					cwd={cwd}
					workspaces={workspaces}
					launch={newStart}
					connected={connected}
					completions={newSessionCompletions}
					onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "new", cwd }, text, cursor })}
					onPickCwd={next => {
						// A failed start's error is about the directory left behind.
						dismissStart("new");
						location.hash = hashForNewSession(next, page.todoId);
					}}
					onStart={op => start({ kind: "new", cwd, ...op, todoId: seed && page.todoId })}
					onSchedule={(op, when) => scheduleSend({ kind: "start", request: newSessionRequest(cwd, op.prompt, { ...op, todoId: seed && page.todoId }) }, when)}
					todo={seed}
					draftKey={pending ? null : newDraftKey(seed ? page.todoId : null)}
					board={note => <NewSessionBoard cwd={cwd} hosts={visible.hosts} past={visible.past} workspace={workspace} note={note} />}
				/>
			);
		}
		case "scheduled":
			return <ScheduledSession id={page.id} workspaces={workspaces} connected={connected} completions={newSessionCompletions} todoOf={todoId => todoSeed(userTodos, todoId)} />;
		case "settings":
			return (
				<SettingsPage
					section={page.section}
					cwd={workspace}
					onPickWorkspace={pickWorkspace}
					workspaces={workspaces}
					workspaceList={workspaceList}
					pins={pins}
				/>
			);
		case "pull-requests":
			return <PullRequestsPage workspace={workspace} hosts={visible.hosts} past={visible.past} section={sectionTarget} route={page} />;
		case "tickets":
			if (linear && !linearCallable) return <DisconnectedPage title={TICKETS_TITLE} meta={TICKETS_META} integration={linear} />;
			// Until the sessions are listed, the workspace a quick action starts in is not known yet.
			if (!listed) return <p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>;
			return <TicketsPage target={page.target} section={sectionTarget} cwd={defaultWorkspace} hosts={visible.hosts} />;
		case "todo":
			// A linked session resolves wherever it ran, even in a directory the sidebar does not list.
			return (
				<TodoPage
					list={userTodos}
					view={todoView}
					openId={page.open}
					hosts={hosts}
					past={past}
					disabled={!connected}
					onChange={changeTodo}
					newSessionCwd={defaultWorkspace}
					linearConnected={linearCallable}
				/>
			);
		case "notes":
			return <NotesPage list={userNotes} todos={userTodos} view={page.list} openId={page.open} hosts={hosts} past={past} disabled={!connected} onChange={changeNote} />;
		case "bots": {
			if (page.target === null) {
				if (page.adding) return <NewBot workspaces={workspaces} defaultCwd={defaultWorkspace} connected={connected} />;
				return <BotsGallery rows={bots === null ? null : botRows(bots, hosts, botLasts)} routines={routines} />;
			}
			if (!openBot) return <p className="m-auto text-sm text-muted-foreground">{bots === null ? "Loading the Bots…" : "No Bot has this address. It may have been deleted."}</p>;
			return (
				// Keyed by the Bot, so another Bot's page starts with its own drafts.
				<BotPage
					key={openBot.bot.id}
					open={openBot}
					detailsOpen={rightOpen}
					onToggleDetails={() => toggleSidebar("right")}
					past={past}
					lastHosts={lastHosts}
					models={models}
					workspaces={workspaces}
					connected={connected}
					completions={newSessionCompletions}
				/>
			);
		}
		case "calendar":
			return <CalendarPage routines={routines} todos={userTodos} ticketsShown={linearCallable} workspace={workspace} />;
		case "email":
			return <EmailPage target={page.target} workspace={workspace} />;
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
