import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Command,
	Folder,
	History,
	Keyboard,
	Layers,
	ListTodo,
	type LucideIcon,
	PanelLeft,
	PanelRight,
	Plus,
	Repeat,
	Search,
	SquareTerminal,
	Wrench,
} from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../../src/shared/projects";
import type { PastSession, RosterHost, View } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import type { UserTodo, UserTodoCategory } from "../../../src/user-todos-shared";
import {
	type Accessory,
	bumpFrecency,
	chordAction,
	decodeFrecency,
	FRECENCY_KEY,
	highlightOnFound,
	PALETTE_VIEWS,
	PANEL_CHORD,
	type PaletteAction,
	paletteCommands,
	type PaletteEvent,
	type PaletteItem,
	paletteSections,
	type PaletteState,
	type PaletteViewId,
	primaryAction,
	topFrame,
} from "../../command-palette";
import { localDay } from "../../days";
import { age, folderName, hostLabel, pastLabel } from "../../labels";
import { PAGE_ICON } from "../../page-icons";
import { conversationItems, recordItems } from "../../palette-records";
import { useConversationHits, useSearchSources } from "../../reads";
import { hashForProjects, type OpenMode } from "../../routing";
import { revealMessage } from "../../message-reveal";
import { sessionActions, type SessionEntry } from "../../session-actions";
import { pressesChord, type ShortcutHandlers, type ShortcutId, shortcutLabels } from "../../shortcuts";
import { useStoredState } from "../../stored-state";
import { quickAddTodo } from "../../todo-quick-add";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { StatusDot } from "../status-dot";
import { ActionPanel } from "./action-panel";
import { Kbd, PaletteFooter } from "./palette-footer";

const COMMAND_ICON: Partial<Record<ShortcutId, LucideIcon>> = {
	newSession: Plus,
	previousSession: ArrowUp,
	nextSession: ArrowDown,
	tools: Wrench,
	sessionsSidebar: PanelLeft,
	detailsSidebar: PanelRight,
	settings: PAGE_ICON.settings,
	help: Keyboard,
	"pull-requests": PAGE_ICON["pull-requests"],
	tickets: PAGE_ICON.tickets,
	newTicket: PAGE_ICON.tickets,
	sessions: PAGE_ICON.sessions,
	todo: PAGE_ICON.todo,
	calendar: PAGE_ICON.calendar,
	routines: Repeat,
	projects: PAGE_ICON.projects,
	terminal: SquareTerminal,
};

interface CommandPaletteProps {
	/** The open palette, or `null` while it is closed. */
	state: PaletteState | null;
	dispatch: (event: PaletteEvent) => void;
	hosts: RosterHost[];
	past: PastSession[];
	/** The workspaces, as the sidebar's workspace picker lists them. */
	workspaces: Workspace[];
	/** The sidebar's workspace, or `null` for all workspaces. */
	workspace: string | null;
	/** Open `view`, whose session ran in `cwd`, and keep it listed by switching the sidebar to its workspace. */
	onOpenSession: (view: View, cwd: string, mode: OpenMode) => void;
	onPickWorkspace: (cwd: string | null) => void;
	/** Pinned sessions, by session ID. */
	pinned: ReadonlySet<string>;
	onTogglePin: (sessionId: string) => void;
	/** What the page's shortcuts run; each with a command title lists as a command. */
	handlers: ShortcutHandlers;
	/** Commands that do nothing now, which the palette leaves out. */
	unavailable: ReadonlySet<ShortcutId>;
	/** The todo list's categories, which a typed `#category` files a new todo under; `null` while the list cannot be edited. */
	todoCategories: readonly UserTodoCategory[] | null;
	/** The todo list's top-level todos, which a search lists. */
	todos: readonly UserTodo[];
	/** Linear answers, so a search lists the tickets assigned to you. */
	linearConnected: boolean;
	/** Every project; the ones not archived list as items that open their page. */
	projects: readonly Project[];
	/** Open the new-ticket dialog with a title, which a search offers while Linear answers. */
	onCreateTicket: (title: string) => void;
}

/**
 * Searches running and past sessions in every workspace, projects, the page's commands, and workspaces, and for a search
 * also the todos, your Linear tickets, and the sidebar workspace's pull requests; Enter runs the highlighted entry's first
 * action, ⌘K lists the rest, and what you type can become a todo or a Linear ticket's title. Its props hold no closure
 * built per render, so a socket update that touches none of them skips it, and a closed palette renders and reads nothing.
 */
export const CommandPalette = memo(function CommandPalette({ state, ...props }: CommandPaletteProps) {
	return state && <OpenCommandPalette state={state} {...props} />;
});

function OpenCommandPalette({ state, dispatch, hosts, past, workspaces, workspace, onOpenSession, onPickWorkspace, pinned, onTogglePin, handlers, unavailable, todoCategories, todos, linearConnected, projects, onCreateTicket }: CommandPaletteProps & { state: PaletteState }) {
	const { send, start, end, changeTodo } = useDashboardActions();
	const { starts, ending, pullRequestsScope } = useDashboardStatus();
	const [frecency, setFrecency] = useStoredState(FRECENCY_KEY, decodeFrecency, JSON.stringify);
	const inputRef = useRef<HTMLInputElement>(null);
	const focusInput = useCallback(() => inputRef.current?.focus(), []);
	const { tickets, pullRequestRepos } = useSearchSources(linearConnected, pullRequestsScope);
	// One clock for as long as the palette is open, so a row's frecency does not decay and reorder the list under the pointer.
	const [now] = useState(() => Date.now());
	const frame = topFrame(state);
	const viewId = frame.view;
	const view = PALETTE_VIEWS[viewId];
	const query = frame.query;
	const search = query.trim();
	const resuming = starts.resume?.phase === "starting" ? starts.resume.op.sessionId : null;
	const hits = useConversationHits(viewId === "root" ? search : "");

	const sessionItems = useMemo((): PaletteItem[] => {
		const sessionItem = (entry: SessionEntry): PaletteItem => {
			const row = entry.kind === "live" ? entry.host : entry.session;
			const actions = sessionActions(entry, {
				onScreen: false,
				pinned: pinned.has(row.sessionId),
				resuming,
				ending: entry.kind === "live" && ending.has(entry.host.instanceId),
				open: (picked, mode) => onOpenSession(picked, row.cwd, mode),
				togglePin: onTogglePin,
				resume: sessionId => start({ kind: "resume", sessionId }),
				dismissInterrupted: sessionId => send({ t: "dismiss-interrupted", sessionId }),
				end,
			});
			const keywords = [...row.pullRequests.map(pr => `${pr.repo}#${pr.number}`), ...row.tickets];
			return entry.kind === "live"
				? {
						id: `session:${entry.host.instanceId}`,
						section: "running",
						title: hostLabel(entry.host),
						subtitle: row.cwdDisplay,
						keywords,
						icon: PAGE_ICON.sessions,
						accessories: [
							{ kind: "status", status: entry.host.status },
							{ kind: "age", at: entry.host.startedAt },
						],
						kind: "Session",
						actions,
					}
				: {
						id: `session:${entry.session.sessionId}`,
						section: "past",
						title: pastLabel(entry.session),
						subtitle: row.cwdDisplay,
						keywords,
						icon: History,
						accessories: [{ kind: "age", at: entry.session.modifiedAt }],
						kind: "Session",
						actions,
					};
		};
		return [...hosts.map(host => sessionItem({ kind: "live", host })), ...past.map(session => sessionItem({ kind: "past", session }))];
	}, [hosts, past, pinned, resuming, ending, onOpenSession, onTogglePin, start, send, end]);

	const projectItems = useMemo(
		(): PaletteItem[] =>
			projects
				.filter(project => !project.archived)
				.map(project => ({
					id: `project:${project.id}`,
					section: "projects",
					title: project.name,
					subtitle: project.cwd,
					keywords: project.workers.map(worker => worker.title),
					icon: PAGE_ICON.projects,
					accessories: [],
					kind: "Project",
					actions: [[{ id: "open", title: "Open project", icon: PAGE_ICON.projects, run: { kind: "link", href: hashForProjects({ kind: "project", id: project.id }) } }]],
				})),
		[projects],
	);

	const commandItems = useMemo((): PaletteItem[] => {
		const pushItem = (id: string, title: string, icon: LucideIcon, target: PaletteViewId, keywords: string[], keys: readonly string[]): PaletteItem => ({
			id,
			section: "commands",
			title,
			keywords,
			icon,
			accessories: keys.length > 0 ? [{ kind: "keys", labels: keys }] : [],
			kind: "Command",
			actions: [[{ id: "open", title: "Open", icon, run: { kind: "push", view: target } }]],
		});
		return [
			...paletteCommands(handlers, unavailable).map(
				({ id, command, label }): PaletteItem => ({
					id: `command:${id}`,
					section: "commands",
					title: command,
					keywords: [label],
					icon: COMMAND_ICON[id] ?? Command,
					accessories: [{ kind: "keys", labels: shortcutLabels(id) }],
					kind: "Command",
					actions: [[{ id: "run", title: "Run command", icon: COMMAND_ICON[id] ?? Command, run: { kind: "do", fn: () => void handlers[id]?.() } }]],
				}),
			),
			pushItem("command:workspace", "Choose workspace…", Folder, "workspaces", ["switch workspace", "directory"], shortcutLabels("workspace")),
			pushItem("command:create-todo", "Create todo", ListTodo, "createTodo", ["add todo", "task"], []),
		];
	}, [handlers, unavailable]);

	const workspaceItems = useMemo((): PaletteItem[] => {
		const pickWorkspace = (cwd: string | null): void => {
			if (cwd !== workspace) onPickWorkspace(cwd);
		};
		const workspaceItem = (id: string, title: string, subtitle: string | undefined, icon: LucideIcon, cwd: string | null): PaletteItem => ({
			id,
			section: "workspaces",
			title,
			subtitle,
			keywords: [],
			icon,
			accessories: cwd === workspace ? [{ kind: "text", text: "Current" }] : [],
			kind: "Workspace",
			actions: [[{ id: "pick", title: "Show its sessions", icon, run: { kind: "do", fn: () => pickWorkspace(cwd) } }]],
		});
		return [
			workspaceItem("workspace:all", "All workspaces", undefined, Layers, null),
			...workspaces.map(({ cwd, cwdDisplay }) => workspaceItem(`workspace:${cwd}`, folderName(cwdDisplay) ?? cwdDisplay, cwdDisplay, Folder, cwd)),
		];
	}, [workspaces, workspace, onPickWorkspace]);

	const records = useMemo((): PaletteItem[] => recordItems({ todos, tickets, pullRequestRepos }), [todos, tickets, pullRequestRepos]);
	const conversations = useMemo(
		(): PaletteItem[] =>
			conversationItems(hits, hosts, past, (opened, cwd, mode, messageId) => {
				onOpenSession(opened, cwd, mode);
				revealMessage(opened, messageId);
			}),
		[hits, hosts, past, onOpenSession],
	);

	const items = useMemo((): PaletteItem[] => {
		const createTodo = (): void => {
			const change = todoCategories && quickAddTodo(search, todoCategories, localDay());
			if (change) changeTodo(change);
		};
		const todoItem = (id: string, section: "fallback" | "createTodo", title: string, subtitle?: string): PaletteItem[] =>
			todoCategories && search
				? [
						{
							id,
							section,
							title,
							subtitle,
							keywords: [],
							icon: ListTodo,
							accessories: [],
							kind: "Todo",
							actions: [[{ id: "create", title: "Create todo", icon: ListTodo, run: { kind: "do", fn: createTodo } }]],
						},
					]
				: [];
		/** What you typed, as the title of a new Linear issue in the dialog that opens it. */
		const ticketItem = (): PaletteItem[] =>
			linearConnected && search
				? [
						{
							id: "fallback:create-ticket",
							section: "fallback",
							title: `Create ticket “${search}”`,
							keywords: [],
							icon: PAGE_ICON.tickets,
							accessories: [],
							kind: "Ticket",
							actions: [[{ id: "create", title: "Create ticket", icon: PAGE_ICON.tickets, run: { kind: "do", fn: () => onCreateTicket(search) } }]],
						},
					]
				: [];
		const itemsOf: Record<PaletteViewId, () => PaletteItem[]> = {
			root: () => [...sessionItems, ...projectItems, ...records, ...conversations, ...commandItems, ...todoItem("fallback:create-todo", "fallback", `Create todo “${search}”`), ...ticketItem()],
			workspaces: () => workspaceItems,
			createTodo: () => todoItem("fallback:create-todo", "createTodo", "Create todo", search),
		};
		return itemsOf[viewId]();
	}, [viewId, sessionItems, projectItems, records, conversations, commandItems, workspaceItems, search, todoCategories, changeTodo, linearConnected, onCreateTicket]);
	const sections = useMemo(() => paletteSections(items, query, frecency, now, view.suggestions), [items, query, frecency, now, view.suggestions]);
	const selected = sections.flatMap(section => section.items).find(item => item.id === frame.selected) ?? null;
	const panelItem = state.panel && selected?.id === state.panel.itemId ? selected : null;
	// Runs as the conversation matches arrive, with the sections that list them.
	useEffect(() => {
		const id = hits.length > 0 ? highlightOnFound(sections, frame.selected) : null;
		if (id !== null) dispatch({ type: "select", itemId: id });
	}, [hits]);
	const empty =
		frame.view !== "createTodo" ? "No results." : todoCategories ? "Type the todo’s title." : "Todos cannot be edited while the dashboard is disconnected.";

	const run = (item: PaletteItem, action: PaletteAction): void => {
		if (action.disabled) return;
		setFrecency(prev => bumpFrecency(prev, item.id, Date.now()));
		const effect = action.run;
		if (effect.kind === "push") return dispatch({ type: "push", view: effect.view });
		dispatch({ type: "close" });
		if (effect.kind === "do") effect.fn();
		else if (effect.external) window.open(effect.href, "_blank", "noopener,noreferrer");
		else window.location.hash = effect.href;
	};
	const onKeyDown = (event: ReactKeyboardEvent): void => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Backspace" && frame.query === "") {
			// Going back restores the previous view's search; the key must not then delete its last character.
			event.preventDefault();
			return dispatch({ type: "backspaceOnEmpty" });
		}
		// The page's own ⌘K would close the palette.
		if (pressesChord(event, PANEL_CHORD)) {
			event.preventDefault();
			return dispatch({ type: "togglePanel" });
		}
		const action = selected && chordAction(selected, event);
		if (!selected || !action) return;
		event.preventDefault();
		run(selected, action);
	};

	return (
		<DialogPrimitive.Root
			open
			onOpenChange={open => {
				if (!open) dispatch({ type: "close" });
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/20 dark:bg-black/50" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					onEscapeKeyDown={event => {
						// Esc steps back one level at a time; the reducer decides when it closes the palette.
						event.preventDefault();
						dispatch({ type: "escape" });
					}}
					className="fixed top-[15vh] left-1/2 z-50 flex w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.02),0_8px_16px_-4px_rgb(0_0_0/0.12),0_24px_48px_-12px_rgb(0_0_0/0.25)] outline-hidden"
				>
					<DialogPrimitive.Title className="sr-only">Command menu</DialogPrimitive.Title>
					<CommandPrimitive
						label="Command menu"
						shouldFilter={false}
						loop
						value={frame.selected}
						onValueChange={itemId => dispatch({ type: "select", itemId })}
						onKeyDown={onKeyDown}
					>
						<div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
							{state.stack.length > 1 ? (
								<button
									type="button"
									aria-label={`Back from ${view.title}`}
									onClick={() => dispatch({ type: "pop" })}
									className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
								>
									<ArrowLeft className="size-3.5" />
									{view.title}
								</button>
							) : (
								<Search className="size-4 shrink-0 text-muted-foreground" />
							)}
							<CommandPrimitive.Input
								ref={inputRef}
								autoFocus
								value={frame.query}
								onValueChange={query => dispatch({ type: "query", query })}
								placeholder={view.placeholder}
								className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-muted-foreground"
							/>
						</div>
						<CommandPrimitive.List className="h-[min(26rem,60vh)] scroll-py-2 overflow-y-auto overscroll-contain px-2 pb-2">
							<CommandPrimitive.Empty className="py-16 text-center text-sm text-muted-foreground">{empty}</CommandPrimitive.Empty>
							{sections.map(section => (
								<CommandPrimitive.Group
									key={section.id}
									heading={section.heading ?? undefined}
									className="pt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
								>
									{section.items.map(item => (
										<Row key={item.id} item={item} onSelect={() => run(item, primaryAction(item))} />
									))}
								</CommandPrimitive.Group>
							))}
						</CommandPrimitive.List>
					</CommandPrimitive>
					<PaletteFooter icon={view.icon} title={view.title} primary={selected && primaryAction(selected).title} onPrimary={() => selected && run(selected, primaryAction(selected))}>
						<ActionPanel
							item={selected}
							query={panelItem && state.panel ? state.panel.query : null}
							onToggle={() => dispatch({ type: "togglePanel" })}
							onQuery={query => dispatch({ type: "panelQuery", query })}
							onRun={action => selected && run(selected, action)}
							returnFocus={focusInput}
						/>
					</PaletteFooter>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** One entry: its icon tile, title, muted subtitle, then its accessories and type. */
function Row({ item, onSelect }: { item: PaletteItem; onSelect: () => void }) {
	const { icon: Icon } = item;
	return (
		<CommandPrimitive.Item
			value={item.id}
			onSelect={onSelect}
			className="flex h-10 cursor-default items-center gap-3 rounded-md px-2 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
		>
			<span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground [&_svg]:size-3.5">
				<Icon />
			</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="max-w-[70%] shrink-0 truncate">{item.title}</span>
				{item.subtitle && <span className="min-w-0 truncate text-xs text-muted-foreground">{item.subtitle}</span>}
			</span>
			{item.accessories.map(accessory => (
				<AccessoryView key={accessory.kind} accessory={accessory} />
			))}
			<span className="w-14 shrink-0 text-right text-xs text-muted-foreground">{item.kind}</span>
		</CommandPrimitive.Item>
	);
}

function AccessoryView({ accessory }: { accessory: Accessory }) {
	switch (accessory.kind) {
		case "age":
			return <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{age(accessory.at)}</span>;
		case "status":
			return <StatusDot status={accessory.status} />;
		case "keys":
			return (
				<span className="flex shrink-0 gap-1">
					{accessory.labels.map(label => (
						<Kbd key={label} className="h-5 min-w-5 text-[11px]">
							{label}
						</Kbd>
					))}
				</span>
			);
		case "text":
			return <span className="shrink-0 text-xs text-muted-foreground">{accessory.text}</span>;
	}
}
