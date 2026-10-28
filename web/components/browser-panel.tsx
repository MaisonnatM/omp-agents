/**
 * `BrowserPanel`: a live session's running app in the desktop app's `<webview>`, shown in the right sidebar's Browser
 * tab, where the elements selected and the marks drawn on the page land in the session's composer as one chip and its
 * picture, and a whole page as an image.
 */
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Maximize2, Minimize2, MousePointerClick, Play, RotateCw, Server } from "lucide-react";
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

/** A toolbar control of the Browser, named by its tooltip. */
function ToolbarButton({ label, control, disabled, shortcut, pressed, onClick, children }: {
	label: string;
	control: ControlId;
	disabled: boolean;
	shortcut?: readonly string[];
	/** Set for a toggle: whether it is on. */
	pressed?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip content={label} shortcut={shortcut} side="bottom" disabled={disabled}>
			<Button {...activityControl(control)} variant="ghost" size="icon-compact" aria-label={label} aria-pressed={pressed} active={pressed} disabled={disabled} onClick={onClick}>
				{children}
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

/**
 * Live session `view`'s app in a `<webview>`, opened on the address last loaded for `sessionId`, else on the first port
 * its jobs and services listen on. Each **Attach** of what was picked in it is appended to the view's composer.
 */
export function BrowserPanel({ view, sessionId }: { view: LiveView; sessionId: string }) {
	const { read } = sessionProcessesStore.use();
	const candidates = useMemo(() => browserCandidates(read?.data ?? null, view.instanceId), [read, view.instanceId]);
	const ports = useMemo(
		() => ({ session: candidates.map(candidate => candidate.port), other: read?.data.find(listed => listed.instanceId === view.instanceId)?.otherPorts ?? [] }),
		[candidates, read, view.instanceId],
	);
	const [saved] = useState(() => addresses.get(sessionId));
	const [maximized, setMaximized] = useState(false);
	const webview = useWebview({
		initial: initialAddress(saved, candidates),
		onSelection: boxes => picking.onSelection(boxes),
		onNavigate: url => addresses.set(sessionId, url),
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
	useShortcuts({ browserRestore: () => picking.stop() || (maximized ? setMaximized(false) : false) });
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
