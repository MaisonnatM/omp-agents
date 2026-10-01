import { X } from "lucide-react";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import type { View } from "../src/shared";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Conversation, PastConversation } from "./components/conversation";
import { InboxPage } from "./components/inbox-page";
import { PlanUsageFooter } from "./components/plan-usage";
import { Roster, useProject } from "./components/roster";
import { SettingsPage } from "./components/settings-page";
import { SidebarResizeHandle, storedSidebarWidth } from "./components/sidebar-resize-handle";
import { EMPTY_PANE, useDashboard } from "./use-dashboard";
import {
	closePane,
	defaultCwd,
	type ForkPoint,
	focusedView,
	hashForSettings,
	hashForView,
	INBOX_HASH,
	sameView,
	settingsFromHash,
	workspaces,
} from "./view-model";

const subscribeHash = (onChange: () => void): (() => void) => {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
};

function EmptyState({ rosterError }: { rosterError: string | null }) {
	return (
		<section className="m-auto max-w-lg space-y-3 p-8 text-sm">
			<h2 className="text-base font-semibold">No omp sessions are published</h2>
			<p>
				Sessions publish themselves to the local Collab registry when <code>collab.autoStart</code> is <code>control</code>{" "}
				(or <code>view</code> for read-only):
			</p>
			<pre className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
				omp config set collab.autoStart control
			</pre>
			<p>
				Only sessions started after that setting changed appear here. Restart sessions that were already running, or
				run <code>/new</code> or <code>/collab</code> inside them. Or start one here with the <strong>+</strong> next to
				the session list.
			</p>
			{rosterError && <p className="text-red-600 dark:text-red-400">Registry error: {rosterError}</p>}
		</section>
	);
}

export function App() {
	const { state, send, open, focus, show, setLaunchOpen, create, fork } = useDashboard();
	const initialWidth = useMemo(storedSidebarWidth, []);
	const hash = useSyncExternalStore(subscribeHash, () => location.hash);
	const settings = settingsFromHash(hash);
	const inbox = hash === INBOX_HASH;
	const [project, pickProject] = useProject(workspaces(state.hosts, state.past));
	const { layout } = state;
	const view = focusedView(layout);
	const viewHost = view?.kind === "live" ? state.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const viewPast = view?.kind === "past" ? state.past.find(s => s.sessionId === view.sessionId) : undefined;
	const split = layout.panes.length > 1;

	const paneContent = (pane: View, actions: ReactNode): ReactNode => {
		const { items, completions } = state.panes.get(hashForView(pane)) ?? EMPTY_PANE;
		const onFork = (itemId: string, point: ForkPoint) => fork(pane, itemId, point);
		if (pane.kind === "past") {
			return (
				<PastConversation
					sessionId={pane.sessionId}
					session={state.past.find(s => s.sessionId === pane.sessionId) ?? null}
					items={items}
					fork={state.fork}
					onFork={onFork}
					actions={actions}
				/>
			);
		}
		const { instanceId } = pane;
		return (
			<Conversation
				view={pane}
				host={state.hosts.find(h => h.instanceId === instanceId) ?? null}
				lastHost={state.lastHosts.get(instanceId) ?? null}
				items={items}
				initialDraft={state.draft && sameView(state.draft.view, pane) ? state.draft.text : ""}
				fork={state.fork}
				onFork={onFork}
				completions={completions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, view: pane, text, cursor })}
				models={state.models.get(instanceId) ?? null}
				onListModels={() => send({ t: "list-models", instanceId })}
				onSetModel={model => send({ t: "set-model", instanceId, model })}
				onSetThinking={level => send({ t: "set-thinking", instanceId, level })}
				onPrompt={text => send({ t: "prompt", view: pane, text })}
				onAbort={() => send({ t: "abort", instanceId })}
				onEnd={() => send({ t: "end", instanceId })}
				onAnswer={(requestId, answer) => send({ t: "answer", instanceId, requestId, answer })}
				actions={actions}
			/>
		);
	};

	let main: ReactNode;
	if (settings) {
		main = <SettingsPage cwd={settings.cwd} workspaces={workspaces(state.hosts, state.past)} />;
	} else if (inbox) {
		// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
		main = state.listed ? (
			<InboxPage project={project} hosts={state.hosts} past={state.past} onOpen={open} />
		) : (
			<p className="m-auto text-sm text-muted-foreground">Listing sessions…</p>
		);
	} else if (layout.panes.length > 0) {
		main = (
			<div className={cn("grid h-svh min-h-0 gap-px bg-border", split ? "grid-cols-2" : "grid-cols-1", layout.panes.length > 2 && "grid-rows-2")}>
				{layout.panes.map((pane, index) => (
					// Keyed by view: moving to another cell keeps a pane's draft and scroll; another view resets them.
					<section
						key={hashForView(pane)}
						tabIndex={-1}
						aria-label={`Pane ${index + 1} of ${layout.panes.length}${index === layout.focus ? ", focused" : ""}`}
						data-pane={index}
						data-focused={index === layout.focus || undefined}
						onPointerDownCapture={() => index !== layout.focus && focus(index)}
						onFocusCapture={() => index !== layout.focus && focus(index)}
						className={cn(
							"relative flex min-h-0 min-w-0 flex-col bg-background outline-none",
							layout.panes.length === 3 && index === 2 && "col-span-2",
							split && index === layout.focus &&
								"after:pointer-events-none after:absolute after:inset-0 after:z-20 after:ring-2 after:ring-inset after:ring-[color:var(--focus-ring)]",
						)}
					>
						{paneContent(
							pane,
							split && (
								<Button variant="ghost" size="icon-compact" title="Close pane" aria-label="Close pane" onClick={() => show(closePane(layout, index))}>
									<X />
								</Button>
							),
						)}
					</section>
				))}
			</div>
		);
	} else if (state.hosts.length === 0) {
		main = <EmptyState rosterError={state.rosterError} />;
	} else {
		main = (
			<p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
				Select a session to see its conversation. ⌘-click (Ctrl-click) more to see up to four side by side.
			</p>
		);
	}

	return (
		<SidebarProvider width={initialWidth} persist={false} shortcut={null} className="h-svh">
			<Sidebar collapsible="none" className="relative">
				<Roster
					hosts={state.hosts}
					past={state.past}
					open={settings || inbox ? [] : layout.panes}
					connected={state.connected}
					launch={state.launch}
					defaultCwd={defaultCwd(view, state.hosts, state.past)}
					settingsHref={hashForSettings(settings ? settings.cwd : (viewHost ?? viewPast)?.cwd || null)}
					settingsOpen={settings !== null}
					inboxOpen={inbox}
					project={project}
					onPickProject={pickProject}
					onOpen={open}
					onLaunchOpen={setLaunchOpen}
					onCreate={create}
				/>
				<PlanUsageFooter usage={state.usage} />
				<SidebarResizeHandle />
			</Sidebar>
			<SidebarInset>{main}</SidebarInset>
		</SidebarProvider>
	);
}
