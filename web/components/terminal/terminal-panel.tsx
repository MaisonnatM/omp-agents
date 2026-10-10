import { ChevronDown, LoaderIcon, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "../../../src/shared/terminals";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getJson } from "../../api";
import { folderName } from "../../labels";
import { useStoredState } from "../../stored-state";
import { Separator, useDragSeparator } from "../drag-separator";
import { type TerminalHandle, TerminalView } from "./terminal-view";

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

interface Tab {
	key: string;
	target: { id: string } | { cwd: string };
	/** The shell, once the server opened or found it. */
	terminal: TerminalInfo | null;
	/** The server hung up on the tab without its shell exiting, so only closing the tab is left. */
	lost: boolean;
	closing: boolean;
}

const newTab = (cwd: string): Tab => ({ key: crypto.randomUUID(), target: { cwd }, terminal: null, lost: false, closing: false });

interface TerminalPanelProps {
	panel: TerminalPanelState;
	/** Where a new tab's shell starts: the focused session's worktree, else the sidebar's workspace, else `~`. */
	cwd: string;
}

/**
 * The panel under the panes that holds the terminal tabs. It mounts the first time it opens and stays mounted while
 * hidden, as the shells keep running on the server; a reloaded page reopens a tab for each shell the server still runs.
 */
export function TerminalPanel({ panel, cwd }: TerminalPanelProps) {
	const { open, setOpen, height, setHeight } = panel;
	const [tabs, setTabs] = useState<Tab[] | null>(null);
	const [active, setActive] = useState<string | null>(null);
	const views = useRef(new Map<string, TerminalHandle>());
	const latestCwd = useRef(cwd);
	latestCwd.current = cwd;

	const add = useCallback(() => {
		const tab = newTab(latestCwd.current);
		setTabs(current => [...(current ?? []), tab]);
		setActive(tab.key);
	}, []);

	useEffect(() => {
		if (!open || tabs !== null) return;
		let cancelled = false;
		getJson<TerminalInfo[]>("/api/terminals")
			.catch((): TerminalInfo[] => [])
			.then(running => {
				if (cancelled) return;
				const restored = running.length ? running.map((terminal): Tab => ({ key: terminal.id, target: { id: terminal.id }, terminal, lost: false, closing: false })) : [newTab(latestCwd.current)];
				setTabs(restored);
				setActive(restored.at(-1)!.key);
			});
		return () => {
			cancelled = true;
		};
	}, [open, tabs]);

	// The last tab closing hides the panel, and the next open starts a fresh shell.
	useEffect(() => {
		if (tabs?.length !== 0) return;
		setOpen(false);
		setTabs(null);
	}, [tabs, setOpen]);

	const remove = (key: string): void => {
		setTabs(current => {
			const next = (current ?? []).filter(tab => tab.key !== key);
			setActive(shown => (shown === key ? (next.at(-1)?.key ?? null) : shown));
			return next;
		});
	};
	const close = (tab: Tab): void => {
		if (!tab.terminal || tab.lost) return remove(tab.key);
		views.current.get(tab.key)?.kill();
		update(tab.key, { closing: true });
	};
	const update = (key: string, change: Partial<Tab>): void => setTabs(current => current?.map(tab => (tab.key === key ? { ...tab, ...change } : tab)) ?? null);

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

	if (tabs === null) return null;
	const shown = tabs.find(tab => tab.key === active);
	return (
		<section ref={section} aria-label="Terminal" hidden={!open} style={{ height: clamp(height) }} className="relative flex shrink-0 flex-col border-t border-border bg-background">
			<Separator {...events} axis="horizontal" label="Resize the terminal" min={MIN_HEIGHT} max={room()} now={height} className="top-0 left-0 h-3 w-full -translate-y-1/2 cursor-row-resize flex-col select-none" />
			<div className="flex h-8 shrink-0 items-center gap-1 px-2">
				<div role="tablist" aria-label="Terminals" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
					{tabs.map(tab => {
						const dir = tab.terminal?.cwdDisplay ?? ("cwd" in tab.target ? tab.target.cwd : "");
						const name = folderName(dir) ?? dir;
						const selected = tab.key === active;
						return (
							<div key={tab.key} className={cn("flex shrink-0 items-center rounded-md text-xs", selected ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")}>
								<button type="button" role="tab" aria-selected={selected} title={dir} onClick={() => setActive(tab.key)} className="max-w-48 truncate rounded-md py-1 pr-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
									{name}
									{tab.lost && " (disconnected)"}
								</button>
								<Tooltip content={tab.closing ? "Ending its shell…" : "Close the terminal, ending its shell"}>
									<button
										type="button"
										aria-label={tab.closing ? `Closing ${name}` : `Close ${name}`}
										aria-busy={tab.closing || undefined}
										disabled={tab.closing}
										onClick={() => close(tab)}
										className="mr-1 rounded-sm p-0.5 opacity-60 outline-none hover:bg-foreground/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
									>
										{tab.closing ? <LoaderIcon aria-hidden className="size-3 animate-spin" /> : <X aria-hidden className="size-3" />}
									</button>
								</Tooltip>
							</div>
						);
					})}
				</div>
				<Tooltip content="New terminal">
					<Button variant="ghost" size="icon-compact" aria-label="New terminal" onClick={add}>
						<Plus />
					</Button>
				</Tooltip>
				<Tooltip content="Hide the terminal">
					<Button variant="ghost" size="icon-compact" aria-label="Hide the terminal" className="ml-auto" onClick={() => setOpen(false)}>
						<ChevronDown />
					</Button>
				</Tooltip>
			</div>
			{tabs.map(tab => (
				<TerminalView
					key={tab.key}
					ref={view => {
						if (view) views.current.set(tab.key, view);
						else views.current.delete(tab.key);
					}}
					target={tab.target}
					active={open && tab.key === active}
					onOpened={terminal => update(tab.key, { terminal })}
					onClosed={exited => (exited || tab.closing ? remove(tab.key) : update(tab.key, { lost: true }))}
				/>
			))}
			{shown && shown.terminal === null && !shown.lost && (
				<p role="status" aria-busy className="pointer-events-none absolute inset-x-0 top-8 bg-background px-2 pt-1 font-mono text-xs text-muted-foreground">
					Starting shell…
				</p>
			)}
		</section>
	);
}
