/** The home's empty state, when no session or page shows. */
import { IconExclamationCircle, IconPlusLarge } from "central-icons";
import { awaitsSubagents, type RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { RunningNow, type RunningTask } from "@/components/ui/running-now";
import { waitOf } from "../attention";
import { hostLabel, modeOf, SPLIT_CLICK } from "../labels";
import { useDashboardActions } from "./dashboard-context";
import { Callout } from "./integrations/integration-row";

/**
 * Each live session of `hosts` that works, waits on you, or finished a turn you have not seen, as a running task whose
 * steps are its subagents; a session idle since you last looked is left out.
 */
export function runningTasks(hosts: readonly RosterHost[]): RunningTask[] {
	return hosts.flatMap((host): RunningTask[] => {
		const wait = waitOf(host);
		const subagents = host.agents.filter(agent => agent.status === "running").length;
		const task = { id: host.instanceId, title: hostLabel(host), done: host.agents.length - subagents, total: host.agents.length };
		if (wait?.kind === "ask") return [{ ...task, state: "needs-you", step: wait.request.title }];
		if (wait?.kind === "input") return [{ ...task, state: "needs-you", step: "Waits for your input" }];
		if (wait?.kind === "turn") return [{ ...task, state: "done", step: wait.turn.reply ?? "Finished its turn" }];
		if (awaitsSubagents(host)) return [{ ...task, state: "running", step: `Waiting on ${subagents} ${subagents === 1 ? "subagent" : "subagents"}` }];
		if (host.status === "working") return [{ ...task, state: "running", step: "Working…" }];
		return [];
	});
}

/** The main area when no session or page shows, with the live sessions `hosts` in a Running now pill. */
export function EmptyHome({ hosts, rosterError }: { hosts: readonly RosterHost[]; rosterError: string | null }) {
	const { openNewSession, open } = useDashboardActions();
	const live = hosts.length > 0;
	return (
		<Empty className="m-auto max-w-lg flex-none">
			<RunningNow tasks={runningTasks(hosts)} title="Live sessions" onOpen={(instanceId, event) => open({ kind: "live", instanceId, agentId: null }, modeOf(event))} />
			<EmptyHeader>
				<EmptyTitle>{live ? "Select a session" : "No sessions are running"}</EmptyTitle>
				<EmptyDescription>{live ? `Choose a session to see its conversation. ${SPLIT_CLICK} more to see up to four side by side.` : "Start a session here, or return to setup whenever you need it."}</EmptyDescription>
			</EmptyHeader>
			<div className="flex flex-wrap justify-center gap-2">
				<Button size="compact" leadingIcon={IconPlusLarge} onClick={() => openNewSession()}>
					New session
				</Button>
				<Button variant="secondary" size="compact" render={<a href="#get-started" />}>
					Get started
				</Button>
			</div>
			{rosterError && (
				<Callout tone="warning" icon={IconExclamationCircle}>
					Registry error: {rosterError}
				</Callout>
			)}
		</Empty>
	);
}
