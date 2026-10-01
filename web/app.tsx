import { type ReactNode, useMemo } from "react";
import { Sidebar, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Conversation, PastConversation } from "./components/conversation";
import { PlanUsageFooter } from "./components/plan-usage";
import { Roster } from "./components/roster";
import { SidebarResizeHandle, storedSidebarWidth } from "./components/sidebar-resize-handle";
import { useDashboard } from "./use-dashboard";
import { defaultCwd, hashForView } from "./view-model";

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
	const { state, send, select, setLaunchOpen, create } = useDashboard();
	const initialWidth = useMemo(storedSidebarWidth, []);
	const { view } = state;

	let pane: ReactNode;
	if (view?.kind === "live") {
		pane = (
			<Conversation
				key={hashForView(view)}
				view={view}
				host={state.hosts.find(h => h.instanceId === view.instanceId) ?? null}
				lastHost={state.viewHost}
				items={state.items}
				completions={state.completions}
				onComplete={(reqId, text, cursor) => send({ t: "complete", reqId, view, text, cursor })}
				onPrompt={text => send({ t: "prompt", view, text })}
				onAbort={() => send({ t: "abort", instanceId: view.instanceId })}
				onEnd={() => send({ t: "end", instanceId: view.instanceId })}
			/>
		);
	} else if (view?.kind === "past") {
		pane = (
			<PastConversation
				key={hashForView(view)}
				sessionId={view.sessionId}
				session={state.past.find(s => s.sessionId === view.sessionId) ?? null}
				items={state.items}
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
					ompVersion={state.ompVersion}
					connected={state.connected}
					launch={state.launch}
					defaultCwd={defaultCwd(view, state.hosts, state.past)}
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
