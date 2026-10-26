/** `TerminalPanel`: the resizable panel under the panes holding the terminal tabs, and its shown/height state. */
import { ChevronDown, LoaderIcon, Plus, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "../../../src/shared/terminals";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson } from "../../api";
import { folderName } from "../../labels";
import { useStoredState } from "../../stored-state";
import { Separator, useDragSeparator } from "../drag-separator";
import { LOADING_TABS, readTerminalTabs, type TerminalTabs } from "./terminal-inventory";
import { closeEndsShell, newTab, nextTabState, type Tab, type TabEvent, tabTerminal } from "./terminal-tab";
import type { TerminalHandle } from "./terminal-view";

// xterm is a chunk of its own, loaded when the panel first opens.
const TerminalView = lazy(() => import("./terminal-view").then(module => ({ default: module.TerminalView })));

const OPEN_KEY = "omp-agents.terminal-open";
const HEIGHT_KEY = "omp-agents.terminal-height";
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
/** The least of the panes a drag or key leaves above the panel, in px. */
const MIN_ABOVE = 160;
const STEP = 16;

/** Whether the terminal panel shows, and its height, which the browser keeps. */
export interface TerminalPanelState {
	open: boolean;
	setOpen: (open: boolean) => void;
	toggle: () => void;
	height: number;
	setHeight: (height: number) => void;
}

export function useTerminalPanel(): TerminalPanelState {
	const [open, setOpen] = useStoredState(OPEN_KEY, raw => raw === "true");
	const [height, setHeight] = useStoredState(HEIGHT_KEY, raw => {
		const stored = Number(raw);
		return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : DEFAULT_HEIGHT;
	});
	const toggle = useCallback(() => setOpen(shown => !shown), [setOpen]);
	return { open, setOpen, toggle, height, setHeight };
}

interface TerminalPanelProps {
	panel: TerminalPanelState;
	/** Where a new tab's shell starts: the focused session's worktree, else the sidebar's workspace, else `~`. */
	cwd: string;
}

/**
 * The panel under the panes that holds the terminal tabs. It mounts the first time it opens and stays mounted while
 * hidden, as the shells keep running on the server; a reloaded page reopens a tab for each shell the server still runs.
 * When the server cannot list its shells, the panel says so and starts none, so a shell it could not list stays unduplicated.
 * Closing a tab asks its shell to exit, a still-starting one's too, and keeps the tab mounted until its socket closes.
 */
export function TerminalPanel({ panel, cwd }: TerminalPanelProps) {
	const { open, setOpen, height, setHeight } = panel;
	const [inventory, setInventory] = useState<TerminalTabs>(LOADING_TABS);
	const [active, setActive] = useState<string | null>(null);
	const views = useRef(new Map<string, TerminalHandle>());
	const latestCwd = useRef(cwd);
	latestCwd.current = cwd;

	const setTabs = useCallback((change: (tabs: Tab[]) => Tab[]): void => {
		setInventory(current => (current.state === "ready" ? { state: "ready", tabs: change(current.tabs) } : current));
	}, []);

	const add = useCallback(() => {
		const tab = newTab(latestCwd.current);
		setTabs(current => [...current, tab]);
		setActive(tab.key);
	}, [setTabs]);

	useEffect(() => {
		if (!open || inventory.state !== "loading") return;
		let cancelled = false;
		void readTerminalTabs(
			() => getJson<TerminalInfo[]>("/api/terminals"),
			() => latestCwd.current,
		).then(read => {
			if (cancelled) return;
			setInventory(read);
			if (read.state === "ready") setActive(read.tabs.at(-1)!.key);
		});
		return () => {
			cancelled = true;
		};
	}, [open, inventory.state]);

	// The last tab closing hides the panel, and the next open starts a fresh shell.
	useEffect(() => {
		if (inventory.state !== "ready" || inventory.tabs.length !== 0) return;
		setOpen(false);
		setInventory(LOADING_TABS);
	}, [inventory, setOpen]);

	/** Moves the tab `key` through `event`, dropping it once it is gone. */
	const dispatch = (key: string, event: TabEvent): void =>
		setTabs(current =>
			current.flatMap(tab => {
				if (tab.key !== key) return [tab];
				const state = nextTabState(tab.state, event);
				return state ? [{ ...tab, state }] : [];
			}),
		);
	const close = (tab: Tab): void => {
		if (closeEndsShell(tab.state)) views.current.get(tab.key)?.kill();
		dispatch(tab.key, { t: "close" });
	};

	const section = useRef<HTMLElement>(null);
	const room = (): number => (section.current?.parentElement?.clientHeight ?? window.innerHeight) - MIN_ABOVE;
	const clamp = (next: number): number => Math.round(Math.max(MIN_HEIGHT, Math.min(room(), next)));
	const events = useDragSeparator({
		value: height,
		onValue: setHeight,
		axis: "horizontal",
		direction: -1,
		keyStep: STEP,
		shiftSteps: 4,
		min: MIN_HEIGHT,
		max: room(),
		reset: DEFAULT_HEIGHT,
		clamp,
		read: (event, start) => clamp(start.value - (event.clientY - start.coordinate)),
	});

	if (inventory.state === "loading") return null;
	const tabs = inventory.state === "ready" ? inventory.tabs : [];
	// A closed tab leaves `active` naming no tab, and the last tab shows instead.
	const shown = tabs.find(tab => tab.key === active) ?? tabs.at(-1);
	return (
		<section ref={section} aria-label="Terminal" hidden={!open} style={{ height: clamp(height) }} className="relative flex shrink-0 flex-col border-t border-border bg-background">
			<Separator {...events} axis="horizontal" label="Resize the terminal" min={MIN_HEIGHT} max={room()} now={height} className="top-0 left-0 h-3 w-full -translate-y-1/2 cursor-row-resize flex-col select-none" />
			<div className="flex h-8 shrink-0 items-center gap-1 px-2">
				<div role="tablist" aria-label="Terminals" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
					{tabs.map(tab => {
						const dir = tabTerminal(tab.state)?.cwdDisplay ?? ("cwd" in tab.target ? tab.target.cwd : "");
						const name = folderName(dir) ?? dir;
						const selected = tab === shown;
						const closing = tab.state.phase === "closing";
						return (
							<div key={tab.key} className={cn("flex shrink-0 items-center rounded-md text-xs", selected ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")}>
								<button type="button" role="tab" aria-selected={selected} title={dir} onClick={() => setActive(tab.key)} className="max-w-48 truncate rounded-md py-1 pr-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
									{name}
									{tab.state.phase === "disconnected" && " (disconnected)"}
								</button>
								<Tooltip content={closing ? "Ending its shell…" : "Close the terminal, ending its shell"}>
									<button
										type="button"
										aria-label={closing ? `Closing ${name}` : `Close ${name}`}
										aria-busy={closing || undefined}
										disabled={closing}
										onClick={() => close(tab)}
										className="mr-1 rounded-sm p-0.5 opacity-60 outline-none hover:bg-foreground/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
									>
										{closing ? <LoaderIcon aria-hidden className="size-3 animate-spin" /> : <X aria-hidden className="size-3" />}
									</button>
								</Tooltip>
							</div>
						);
					})}
				</div>
				{inventory.state === "ready" && (
					<Tooltip content="New terminal">
						<Button variant="ghost" size="icon-compact" aria-label="New terminal" onClick={add}>
							<Plus />
						</Button>
					</Tooltip>
				)}
				<Tooltip content="Hide the terminal">
					<Button variant="ghost" size="icon-compact" aria-label="Hide the terminal" className="ml-auto" onClick={() => setOpen(false)}>
						<ChevronDown />
					</Button>
				</Tooltip>
			</div>
			{inventory.state === "failed" && (
				<div role="alert" className="flex items-center gap-2 px-2 pt-1 text-xs text-red-600 dark:text-red-400">
					<span className="min-w-0 truncate">Cannot read the running shells: {inventory.error}</span>
					<Button variant="secondary" size="compact" onClick={() => setInventory(LOADING_TABS)}>
						Try again
					</Button>
				</div>
			)}
			<Suspense>
				{tabs.map(tab => (
					<TerminalView
						key={tab.key}
						ref={view => {
							if (view) views.current.set(tab.key, view);
							else views.current.delete(tab.key);
						}}
						target={tab.target}
						active={open && tab === shown}
						onOpened={terminal => dispatch(tab.key, { t: "opened", terminal })}
						onClosed={exited => dispatch(tab.key, { t: "closed", exited })}
					/>
				))}
			</Suspense>
			{shown?.state.phase === "starting" && (
				<p role="status" aria-busy className="pointer-events-none absolute inset-x-0 top-8 bg-background px-2 pt-1 font-mono text-xs text-muted-foreground">
					Starting shell…
				</p>
			)}
		</section>
	);
}
