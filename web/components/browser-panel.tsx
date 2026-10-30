/**
 * `BrowserPanel`: a live session's running app in the desktop app's `<webview>`, shown in the right sidebar's Browser
 * tab, where the elements selected and the marks drawn on the page land in the session's composer as one chip and its
 * picture, and a whole page as an image.
 */
import { AppWindow, ArrowLeft, ArrowRight, Camera, ExternalLink, Eye, Maximize2, Minimize2, MousePointerClick, Play, RotateCw, Server, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import type { LiveView } from "../../src/shared/sessions";
import { PREVIEW_PARTITION } from "../../src/shared/desktop-bridge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, MenuSeparator, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { liveDraftKey } from "../composer-drafts";
import { expiringStrings } from "../expiring-strings";
import { browserCandidates, initialAddress } from "../browser-model";
import { type ReviewPage, reviewPagesStore, reviewRequestStore } from "../review-pages";
import { sessionProcessesStore, writeStartServer } from "../reads";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useAction } from "../use-action";
import { useWebview } from "../use-webview";
import { Picking, usePicking } from "./browser-capture";
import { DESKTOP_TITLE_BAR } from "./header-controls";
import { useDashboardActions } from "./dashboard-context";
import { toasts } from "./toaster";

/** What Start dev server sends the session when it cannot start the server itself: a long-lived server the session owns, so its port joins the Browser's candidates. */
const START_SERVER_PROMPT =
	"Start this project's dev server as a named long-lived service in the worktree you work in, on a free port, so the Browser can show it. If it talks to a local server of this project, such as its API, start that one from this worktree as a service too, on its own free port, and point the dev server at it rather than at the default port, which another checkout may serve. Reply with each address.";

/** The window can show a Browser: the desktop app, from the build that added it. */
export const BROWSER_AVAILABLE = typeof window !== "undefined" && window.ompDesktop?.preview === true;

/** The window's shell takes capture requests and picks in the app: the desktop app, from the build that added **Screenshot** and T3 Code's picking. */
const CAPTURE_AVAILABLE = typeof window !== "undefined" && typeof window.ompDesktop?.captureBrowser === "function";

/** The sparkles the page marks agent-made things with, as the notification bell's Updates do. */
export const AI_SPARKLES = "text-violet-600 dark:text-violet-400";

/** The sparkles on an icon button's top right corner, for an action whose result goes to the agent. */
export function AiBadge() {
	return <Sparkles aria-hidden className={cn("pointer-events-none absolute -top-1.5 -right-1.5 size-2.5! fill-current", AI_SPARKLES)} />;
}

/** A toolbar control of the Browser, named by its tooltip. */
function ToolbarButton({ label, control, disabled, shortcut, pressed, ai, onClick, children }: {
	label: string;
	control: ControlId;
	disabled: boolean;
	shortcut?: readonly string[];
	/** Set for a toggle: whether it is on. */
	pressed?: boolean;
	/** What it makes goes to the session's agent, which a sparkles badge marks. */
	ai?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip content={label} shortcut={shortcut} side="bottom" disabled={disabled}>
			<Button
				{...activityControl(control)}
				variant="ghost"
				size="icon-compact"
				aria-label={label}
				aria-pressed={pressed}
				active={pressed}
				disabled={disabled}
				onClick={onClick}
				className={ai ? "relative" : undefined}
			>
				{children}
				{ai && <AiBadge />}
			</Button>
		</Tooltip>
	);
}

/**
 * Makes what `kept` covers inert: each element of the page beside it or an ancestor that lies under its box, leaving
 * alone what stays in view, such as the title bar, and what draws above it, such as toasts. Returns what undoes it.
 */
function inertAround(kept: HTMLElement): () => void {
	const box = kept.getBoundingClientRect();
	const covered = (element: HTMLElement): boolean => {
		const rect = element.getBoundingClientRect();
		const overlaps = rect.width > 0 && rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom && rect.right > box.left && rect.left < box.right;
		return overlaps && getComputedStyle(element).position !== "fixed";
	};
	const made: HTMLElement[] = [];
	for (let node: HTMLElement = kept; node.parentElement; node = node.parentElement) {
		for (const sibling of node.parentElement.children) {
			if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert || !covered(sibling)) continue;
			sibling.inert = true;
			made.push(sibling);
		}
	}
	return () => {
		for (const element of made) element.inert = false;
	};
}

/** The address each session's Browser last loaded, by omp session id, dropped once unused for 30 days. */
const addresses = expiringStrings("omp-agents.preview-addresses", 30 * 24 * 60 * 60 * 1000);

/** A tab of the Browser: the session's own page, or a page the session listed for review. */
interface BrowserTab {
	id: string;
	label: string;
	page: ReviewPage | null;
}

const MAIN_TAB: BrowserTab = { id: "main", label: "App", page: null };

/**
 * Live session `view`'s Browser: its own page, plus one tab per page it listed for review once its toolbar's **Review visuals** asks.
 * Every tab stays mounted once opened, so each page keeps its state while another shows.
 */
export function BrowserPanel({ view, sessionId }: { view: LiveView; sessionId: string }) {
	const pages = reviewPagesStore.use(view.instanceId);
	const requested = reviewRequestStore.use(view.instanceId);
	const [tabs, setTabs] = useState<BrowserTab[]>([MAIN_TAB]);
	const [active, setActive] = useState(MAIN_TAB.id);
	const [handled, setHandled] = useState(0);
	if (requested !== handled) {
		setHandled(requested);
		const review = pages.map(page => ({ id: `review:${page.url}`, label: page.label, page }));
		setTabs([MAIN_TAB, ...review]);
		if (review[0]) setActive(review[0].id);
	}
	const close = (id: string): void => {
		const at = tabs.findIndex(tab => tab.id === id);
		const rest = tabs.filter(tab => tab.id !== id);
		setTabs(rest);
		if (id === active) setActive((rest[at] ?? rest[at - 1] ?? MAIN_TAB).id);
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{tabs.length > 1 && (
				<div role="tablist" aria-label="Browser tabs" className="flex h-9 shrink-0 items-end overflow-x-auto bg-muted/60 px-2 pt-1.5 [scrollbar-width:none]">
					{tabs.map((tab, at) => {
						const selected = tab.id === active;
						// Chrome draws a divider between two tabs that are neither the selected one.
						const divided = at > 0 && !selected && tabs[at - 1]!.id !== active;
						const Icon = tab.page ? Sparkles : AppWindow;
						return (
							<div
								key={tab.id}
								className={cn(
									// The session's own tab is pinned, as in Chrome: its icon alone, so the review tabs keep room for their names.
									"group/tab relative flex h-full items-center rounded-t-lg text-xs",
									tab.page ? "min-w-16 max-w-52 flex-1" : "w-9 flex-none",
									selected ? "z-10 bg-background text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
									divided && "before:absolute before:top-2 before:bottom-2 before:-left-px before:w-px before:bg-border group-hover/tab:before:hidden",
									// The selected tab's feet curve into the toolbar below it, as in Chrome.
									selected &&
										"before:absolute before:bottom-0 before:-left-2 before:size-2 before:bg-[radial-gradient(circle_at_0_0,transparent_0.5rem,var(--color-background)_calc(0.5rem+0.5px))] after:absolute after:-right-2 after:bottom-0 after:size-2 after:bg-[radial-gradient(circle_at_100%_0,transparent_0.5rem,var(--color-background)_calc(0.5rem+0.5px))]",
								)}
							>
								<button
									{...activityControl("browser.tab")}
									type="button"
									role="tab"
									aria-selected={selected}
									title={tab.page?.url ?? "The session's app"}
									onClick={() => setActive(tab.id)}
									onAuxClick={event => event.button === 1 && tab.page && close(tab.id)}
									className={cn(
										"flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-t-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
										tab.page ? "px-2" : "justify-center",
									)}
								>
									<Icon aria-hidden className={cn("size-3.5 shrink-0", tab.page ? AI_SPARKLES : "text-muted-foreground")} />
									<span
										className={cn(
											"min-w-0 truncate",
											tab.page ? "group-focus-within/tab:mask-[linear-gradient(to_left,transparent_1rem,black_2rem)] group-hover/tab:mask-[linear-gradient(to_left,transparent_1rem,black_2rem)]" : "sr-only",
										)}
									>
										{tab.label}
									</span>
								</button>
								{tab.page && (
									<button
										type="button"
										aria-label={`Close ${tab.label}`}
										onClick={() => close(tab.id)}
										className="absolute top-1/2 right-1 grid size-4 -translate-y-1/2 place-items-center rounded-full text-muted-foreground opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 hover:bg-foreground/10 hover:text-foreground"
									>
										<X aria-hidden className="size-3" />
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
			{tabs.map(tab => (
				<div key={tab.id} className={cn("flex min-h-0 flex-1 flex-col", tab.id !== active && "hidden")}>
					{tab.page?.note && <p className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">{tab.page.note}</p>}
					<BrowserPage view={view} sessionId={sessionId} page={tab.page} active={tab.id === active} pages={pages} />
				</div>
			))}
		</div>
	);
}

/**
 * One page of `view`'s Browser in a `<webview>`: a review page's address, else the address last loaded for
 * `sessionId`, else the first port its jobs and services listen on. Each **Attach** of what was picked in it is
 * appended to the view's composer.
 */
function BrowserPage({ view, sessionId, page, active, pages }: { view: LiveView; sessionId: string; page: ReviewPage | null; active: boolean; pages: readonly ReviewPage[] }) {
	const { read } = sessionProcessesStore.use();
	const candidates = useMemo(() => browserCandidates(read?.data ?? null, view.instanceId), [read, view.instanceId]);
	const ports = useMemo(
		() => ({ session: candidates.map(candidate => candidate.port), other: read?.data.find(listed => listed.instanceId === view.instanceId)?.otherPorts ?? [] }),
		[candidates, read, view.instanceId],
	);
	const [saved] = useState(() => addresses.get(sessionId));
	const [maximized, setMaximized] = useState(false);
	const webview = useWebview({
		initial: page?.url ?? initialAddress(saved, candidates),
		onSelection: boxes => picking.onSelection(boxes),
		onNavigate: url => {
			if (page === null) addresses.set(sessionId, url);
		},
		// The app has the focus while maximized, so its Escape stops picking or restores too.
		onEscape: () => picking.stop() || setMaximized(false),
		onPickKey: key => picking.pickKey(key),
		ports,
	});
	const picking = usePicking(webview, liveDraftKey(view));
	const [menuOpen, setMenuOpen] = useState(false);
	const { request } = useDashboardActions();
	const startServer = useAction(async () => {
		const answer = await writeStartServer(view.instanceId);
		if ("started" in answer) {
			webview.load(`http://localhost:${answer.started.port}`);
			toasts.add({ title: `Started ${answer.started.command}` });
			return;
		}
		request({ t: "prompt", view, text: `${START_SERVER_PROMPT}\n\nStarting it directly failed: ${answer.fallback}`, images: [], delivery: "followUp" });
		toasts.add({ title: "Asked the session to start its dev server", description: answer.fallback });
	}, "Cannot start the dev server");
	// The candidates choose the first address, fill the server menu, and name the ports a sign-in comes back to, so `ps` and `lsof` run only until they are read once, and while the menu is open.
	sessionProcessesStore.usePolling(null, webview.src === null || read === null || menuOpen);
	const mounted = webview.src !== null;
	useShortcuts({ browserRestore: () => active && (picking.stop() || (maximized ? setMaximized(false) : false)) });
	const sectionRef = useRef<HTMLElement>(null);
	// What the maximized Browser covers leaves the tab order and the accessibility tree.
	useEffect(() => (maximized && sectionRef.current ? inertAround(sectionRef.current) : undefined), [maximized]);

	return (
		<section
			ref={sectionRef}
			aria-label="Browser"
			// Maximized, it covers the window below its title bar (`DesktopTitleBar`'s h-9), whose window buttons and drag strip stay usable.
			className={cn("flex min-h-0 flex-col bg-background", maximized ? cn("fixed inset-x-0 bottom-0 z-30", DESKTOP_TITLE_BAR ? "top-9" : "top-0") : "flex-1")}
		>
			<div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
				<ToolbarButton label="Back" control="browser.back" disabled={!webview.ready || !webview.history.back} onClick={webview.back}>
					<ArrowLeft />
				</ToolbarButton>
				<ToolbarButton label="Forward" control="browser.forward" disabled={!webview.ready || !webview.history.forward} onClick={webview.forward}>
					<ArrowRight />
				</ToolbarButton>
				<ToolbarButton label="Reload" control="browser.reload" disabled={!webview.ready} onClick={webview.reload}>
					<RotateCw />
				</ToolbarButton>
				<form
					className="mx-1 min-w-0 flex-1"
					onSubmit={event => {
						event.preventDefault();
						webview.load(webview.address);
					}}
				>
					<input
						aria-label="Address"
						value={webview.address}
						placeholder="http://localhost:5173"
						spellCheck={false}
						autoComplete="off"
						onChange={event => webview.setAddress(event.target.value)}
						className="h-7 w-full truncate rounded-md border border-transparent bg-muted/60 px-2 text-xs outline-none placeholder:text-muted-foreground/70 hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
					/>
				</form>
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<Tooltip content="Dev servers this session runs" side="bottom">
						<DropdownMenuTrigger {...activityControl("browser.server")} render={<Button variant="ghost" size="icon-compact" aria-label="Dev servers" />}>
							<Server />
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="end" className="max-w-96">
						{read === null && <MenuItem disabled>Looking for dev servers…</MenuItem>}
						{read !== null && candidates.length === 0 && <MenuItem disabled>This session runs no dev server</MenuItem>}
						{candidates.map(candidate => (
							<MenuItem key={candidate.url} onClick={() => webview.load(candidate.url)}>
								<span className="min-w-0 flex-1 truncate">{candidate.label}</span>
								<span className="font-mono text-xs text-muted-foreground">:{candidate.port}</span>
							</MenuItem>
						))}
						<MenuSeparator />
						<MenuItem {...activityControl("browser.start-server")} disabled={startServer.pending} onClick={() => startServer.run()}>
							<Play />
							{startServer.pending ? "Starting dev server…" : "Start dev server"}
						</MenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{CAPTURE_AVAILABLE && (
					<ToolbarButton
						label="Pick in the app"
						control="browser.select-element"
						disabled={!webview.ready}
						pressed={picking.mode !== null}
						onClick={() => picking.stop() || picking.choose("select")}
					>
						<MousePointerClick />
					</ToolbarButton>
				)}
				{CAPTURE_AVAILABLE && (
					<ToolbarButton label="Screenshot" control="browser.screenshot" disabled={!webview.ready} onClick={() => void picking.screenshot()}>
						<Camera />
					</ToolbarButton>
				)}
				{pages.length > 0 && (
					<ToolbarButton
						label={`Review visuals: ${pages.map(each => each.label).join(" · ")}`}
						control="browser.review-visuals"
						ai
						disabled={false}
						onClick={() => reviewRequestStore.set(view.instanceId, Date.now())}
					>
						<Eye />
					</ToolbarButton>
				)}
				<ToolbarButton
					label={maximized ? "Restore Browser" : "Maximize Browser"}
					control="browser.maximize"
					disabled={false}
					shortcut={maximized ? shortcutLabels("browserRestore") : undefined}
					onClick={() => setMaximized(!maximized)}
				>
					{maximized ? <Minimize2 /> : <Maximize2 />}
				</ToolbarButton>
				<Tooltip content="Open in default browser" side="bottom" disabled={!mounted}>
					<Button
						{...activityControl("browser.open-in-browser")}
						variant="ghost"
						size="icon-compact"
						aria-label="Open in default browser"
						disabled={!mounted}
						render={mounted ? <a href={webview.address} target="_blank" rel="noopener noreferrer" /> : undefined}
					>
						<ExternalLink />
					</Button>
				</Tooltip>
			</div>
			{webview.problem && (
				<p role="status" className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-destructive">
					{webview.problem}
				</p>
			)}
			{webview.src === null ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
					<Server aria-hidden className="size-6 text-muted-foreground/60" />
					<p>No dev server found for this session.</p>
					<p className="text-xs text-muted-foreground/80">Start one, or type its address above.</p>
					<Button
						{...activityControl("browser.start-server")}
						variant="outline"
						size="sm"
						leadingIcon={Play}
						loading={startServer.pending}
						className="mt-1"
						onClick={() => startServer.run()}
					>
						Start dev server
					</Button>
				</div>
			) : (
				<div className="relative flex min-h-0 flex-1">
					<webview
						ref={webview.ref}
						src={webview.src}
						partition={PREVIEW_PARTITION}
						// Without it the guest drops every `window.open` and `target="_blank"` link; with it the shell opens them in the browser.
						// React writes no attribute for `true` on a name it does not know, and Electron reads only the attribute's presence.
						allowpopups={"" as unknown as boolean}
						className="flex min-h-0 w-full flex-1"
					/>
					{picking.mode !== null && (
						<Picking
							mode={picking.mode}
							color={picking.color}
							elements={picking.elements}
							onMode={picking.choose}
							onDeselect={webview.deselect}
							onAttach={picking.attach}
						/>
					)}
				</div>
			)}
		</section>
	);
}
