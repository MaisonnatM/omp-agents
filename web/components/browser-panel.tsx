/**
 * `BrowserPanel`: a live session's running app in the desktop app's `<webview>`, shown in the right sidebar's Browser
 * tab, where an element picked with react-grab lands in the session's composer.
 */
import { ArrowLeft, ArrowRight, ExternalLink, Maximize2, Minimize2, MousePointerClick, Play, RotateCw, Server } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import type { LiveView } from "../../src/shared/sessions";
import { PREVIEW_PARTITION } from "../../src/shared/desktop-bridge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, MenuSeparator, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { appendToComposer, liveDraftKey } from "../composer-drafts";
import { expiringStrings } from "../expiring-strings";
import { initialAddress, browserCandidates } from "../browser-model";
import { sessionProcessesStore } from "../reads";
import { useWebview } from "../use-webview";
import { DESKTOP_TITLE_BAR } from "./header-controls";
import { useDashboardActions } from "./dashboard-context";
import { toasts } from "./toaster";

/** What Start dev server sends the session: a long-lived server it owns, so its port joins the Browser's candidates. */
const START_SERVER_PROMPT =
	"Start this project's dev server as a named long-lived service in the worktree you work in, on a free port, so the Browser can show it. Reply with its address.";

/** The window can show a Browser: the desktop app, from the build that added it. */
export const BROWSER_AVAILABLE = typeof window !== "undefined" && window.ompDesktop?.preview === true;

/** A toolbar control of the Browser, named by its tooltip. */
function ToolbarButton({ label, control, disabled, onClick, children }: {
	label: string;
	control: ControlId;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip content={label} side="bottom" disabled={disabled}>
			<Button {...activityControl(control)} variant="ghost" size="icon-compact" aria-label={label} disabled={disabled} onClick={onClick}>
				{children}
			</Button>
		</Tooltip>
	);
}

/** The address each session's Browser last loaded, by omp session id, dropped once unused for 30 days. */
const addresses = expiringStrings("omp-agents.preview-addresses", 30 * 24 * 60 * 60 * 1000);

/**
 * Live session `view`'s app in a `<webview>`, opened on the address last loaded for `sessionId`, else on the first port
 * its jobs and services listen on. Each element react-grab copies in it is appended to the view's composer.
 */
export function BrowserPanel({ view, sessionId }: { view: LiveView; sessionId: string }) {
	const { read } = sessionProcessesStore.use();
	const candidates = useMemo(() => browserCandidates(read?.data ?? null, view.instanceId), [read, view.instanceId]);
	const [saved] = useState(() => addresses.get(sessionId));
	const draftKey = liveDraftKey(view);
	const webview = useWebview({
		initial: initialAddress(saved, candidates),
		onPick: text => {
			appendToComposer(draftKey, text);
			toasts.add({ title: "Added to the composer" });
		},
		onNavigate: url => addresses.set(sessionId, url),
	});
	const [menuOpen, setMenuOpen] = useState(false);
	const { request } = useDashboardActions();
	const startServer = () => {
		request({ t: "prompt", view, text: START_SERVER_PROMPT, images: [], delivery: "followUp" });
		toasts.add({ title: "Asked the session to start its dev server" });
	};
	// The candidates choose the first address and fill the server menu, so `ps` and `lsof` run only for those.
	sessionProcessesStore.usePolling(null, webview.src === null || menuOpen);
	const mounted = webview.src !== null;
	const [fullScreen, setFullScreen] = useState(false);
	useEffect(() => {
		if (!fullScreen) return;
		const exitOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setFullScreen(false);
		};
		document.addEventListener("keydown", exitOnEscape);
		return () => document.removeEventListener("keydown", exitOnEscape);
	}, [fullScreen]);

	return (
		<section
			aria-label="Browser"
			// Full screen covers the window below its title bar, whose window buttons and drag strip stay usable.
			className={cn("flex min-h-0 flex-col bg-background", fullScreen ? cn("fixed inset-x-0 bottom-0 z-30", DESKTOP_TITLE_BAR ? "top-9" : "top-0") : "flex-1")}
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
						<MenuItem {...activityControl("browser.start-server")} onClick={startServer}>
							<Play />
							Start dev server
						</MenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<ToolbarButton label="Select element" control="browser.select-element" disabled={!webview.ready} onClick={webview.selectElement}>
					<MousePointerClick />
				</ToolbarButton>
				<ToolbarButton label={fullScreen ? "Exit full screen" : "Full screen"} control="browser.full-screen" disabled={false} onClick={() => setFullScreen(!fullScreen)}>
					{fullScreen ? <Minimize2 /> : <Maximize2 />}
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
					<p className="text-xs text-muted-foreground/80">Ask the session to start one, or type its address above.</p>
					<Button {...activityControl("browser.start-server")} variant="outline" size="sm" leadingIcon={Play} className="mt-1" onClick={startServer}>
						Start dev server
					</Button>
				</div>
			) : (
				<webview
					ref={webview.ref}
					src={webview.src}
					partition={PREVIEW_PARTITION}
					// Without it the guest drops every `window.open` and `target="_blank"` link; with it the shell opens them in the browser.
					// React writes no attribute for `true` on a name it does not know, and Electron reads only the attribute's presence.
					allowpopups={"" as unknown as boolean}
					className="flex min-h-0 w-full flex-1"
				/>
			)}
		</section>
	);
}
