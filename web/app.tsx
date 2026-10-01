import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { Sidebar, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Conversation, PastConversation } from "./components/conversation";
import { PlanUsageFooter } from "./components/plan-usage";
import { Roster } from "./components/roster";
import { SettingsPage } from "./components/settings-page";
import { SidebarResizeHandle, storedSidebarWidth } from "./components/sidebar-resize-handle";
import { useDashboard } from "./use-dashboard";
import { defaultCwd, hashForSettings, hashForView, sameView, settingsFromHash, workspaces } from "./view-model";

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
	const { state, send, select, setLaunchOpen, create, fork } = useDashboard();
	const initialWidth = useMemo(storedSidebarWidth, []);
	const settings = settingsFromHash(useSyncExternalStore(subscribeHash, () => location.hash));
	const { view } = state;
	const viewHost = view?.kind === "live" ? state.hosts.find(h => h.instanceId === view.instanceId) : undefined;
	const viewPast = view?.kind === "past" ? state.past.find(s => s.sessionId === view.sessionId) : undefined;

	let pane: ReactNode;
	if (settings) {
		pane = <SettingsPage cwd={settings.cwd} workspaces={workspaces(state.hosts, state.past)} />;
	} else if (view?.kind === "live") {
		pane = (
			<Conversation
				key={hashForView(view)}
				view={view}
				host={viewHost ?? null}
				lastHost={state.viewHost}
				items={state.items}
				initialDraft={state.draft && sameView(state.draft.view, view) ? state.draft.text : ""}
				fork={state.fork}
				onFork={fork}
				completions={state.completions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, view, text, cursor })}
				models={state.models?.instanceId === view.instanceId ? state.models : null}
				onListModels={() => send({ t: "list-models", instanceId: view.instanceId })}
				onSetModel={model => send({ t: "set-model", instanceId: view.instanceId, model })}
				onSetThinking={level => send({ t: "set-thinking", instanceId: view.instanceId, level })}
				onPrompt={text => send({ t: "prompt", view, text })}
				onAbort={() => send({ t: "abort", instanceId: view.instanceId })}
				onEnd={() => send({ t: "end", instanceId: view.instanceId })}
				onAnswer={(requestId, answer) => send({ t: "answer", instanceId: view.instanceId, requestId, answer })}
			/>
		);
	} else if (view?.kind === "past") {
		pane = (
			<PastConversation
				key={hashForView(view)}
				sessionId={view.sessionId}
				session={viewPast ?? null}
				items={state.items}
				fork={state.fork}
				onFork={fork}
			/>
		);
	} else if (state.hosts.length === 0) {
		pane = <EmptyState rosterError={state.rosterError} />;
	} else {
		pane = <p className="m-auto text-sm text-muted-foreground">Select a session to see its conversation.</p>;
	}

	return (
		<SidebarProvider width={initialWidth} persist={false} shortcut={null} className="h-svh">
			<Sidebar collapsible="none" className="relative">
				<Roster
					hosts={state.hosts}
					past={state.past}
					view={view}
					connected={state.connected}
					launch={state.launch}
					defaultCwd={defaultCwd(view, state.hosts, state.past)}
					settingsHref={hashForSettings(settings ? settings.cwd : (viewHost ?? viewPast)?.cwd || null)}
					settingsOpen={settings !== null}
					onSelect={select}
					onLaunchOpen={setLaunchOpen}
					onCreate={create}
				/>
				<PlanUsageFooter usage={state.usage} />
				<SidebarResizeHandle />
			</Sidebar>
			<SidebarInset>{pane}</SidebarInset>
		</SidebarProvider>
	);
}
