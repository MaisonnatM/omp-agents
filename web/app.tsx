import { useMemo } from "react";
import { Sidebar, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Conversation } from "./components/conversation";
import { Roster } from "./components/roster";
import { SidebarResizeHandle, storedSidebarWidth } from "./components/sidebar-resize-handle";
import { useDashboard } from "./use-dashboard";
import { hashForView } from "./view-model";

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
				run <code>/new</code> or <code>/collab</code> inside them.
			</p>
			{rosterError && <p className="text-red-600 dark:text-red-400">Registry error: {rosterError}</p>}
		</section>
	);
}

export function App() {
	const { state, send, select } = useDashboard();
	const initialWidth = useMemo(storedSidebarWidth, []);
	const { view } = state;
	const host = view ? (state.hosts.find(h => h.instanceId === view.instanceId) ?? null) : null;

	return (
		<SidebarProvider width={initialWidth} persist={false} shortcut={null} className="h-svh">
			<Sidebar collapsible="none" className="relative">
				<Roster
					hosts={state.hosts}
					view={view}
					ompVersion={state.ompVersion}
					connected={state.connected}
					onSelect={select}
				/>
				<SidebarResizeHandle />
			</Sidebar>
			<SidebarInset>
				{view ? (
					<Conversation
						key={hashForView(view)}
						view={view}
						host={host}
						lastHost={state.viewHost}
						phase={state.phases[view.instanceId]}
						items={state.items}
						onPrompt={text => send({ t: "prompt", view, text })}
						onAbort={() => send({ t: "abort", instanceId: view.instanceId })}
					/>
				) : state.hosts.length === 0 ? (
					<EmptyState rosterError={state.rosterError} />
				) : (
					<p className="m-auto text-sm text-muted-foreground">Select a session to see its conversation.</p>
				)}
			</SidebarInset>
		</SidebarProvider>
	);
}
