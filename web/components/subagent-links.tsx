/** `SubagentLinks`, where a live view's subagents open and stop, `useSubagentLinks`, which builds it, and `CancelAgentButton`, the stop button after a running subagent's link. */
import { IconStopCircle } from "central-icons";
import { createContext, useMemo } from "react";
import type { AgentRow, LiveView, RosterHost, View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import type { OpenMode } from "../routing";
import { useAction } from "../use-action";
import { useDashboardActions } from "./dashboard-context";

type SubagentView = LiveView & { agentId: string };

/**
 * Where a live view's subagents open: the live session the view belongs to, its registered subagents for their
 * status, and the page's open. `onCancel` cancels a running subagent, as omp's Agent Hub kill does, settling once the server has asked omp to;
 * `null` in a room the dashboard cannot write to.
 */
export interface SubagentLinksValue {
	instanceId: string;
	agents: AgentRow[];
	onOpen: (view: View, mode: OpenMode) => void;
	onCancel: ((view: SubagentView) => Promise<void>) | null;
}

/** `null` in a past session, whose subagents have no view of their own. */
export const SubagentLinks = createContext<SubagentLinksValue | null>(null);

/** The links for `view`'s subagents from its session's roster row `host`; `null` for a past view. */
export function useSubagentLinks(view: View, host: RosterHost | null): SubagentLinksValue | null {
	const { open, request } = useDashboardActions();
	const instanceId = view.kind === "live" ? view.instanceId : null;
	const agents = host?.agents;
	const writable = host?.control.phase === "live" && !host.control.readOnly;
	return useMemo(
		() =>
			instanceId
				? { instanceId, agents: agents ?? [], onOpen: open, onCancel: writable ? agent => request({ t: "cancel-agent", view: agent }) : null }
				: null,
		[instanceId, agents, open, writable, request],
	);
}

export function CancelAgentButton({ view, onCancel, running }: { view: SubagentView; onCancel: (view: SubagentView) => Promise<void>; running: boolean }) {
	const LoaderIcon = useIcon("loader");
	const cancel = useAction(() => onCancel(view), "Could not cancel the subagent");
	if (!running && !cancel.pending) return null;
	return (
		<Tooltip content={cancel.pending ? "Cancelling…" : "Cancel subagent, leaving the session's turn running"}>
			<Button
				variant="ghost"
				size="icon"
				className="size-6 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
				aria-label={cancel.pending ? `Cancelling subagent ${view.agentId}` : `Cancel subagent ${view.agentId}`}
				aria-busy={cancel.pending || undefined}
				disabled={cancel.pending}
				onClick={() => cancel.run()}
			>
				{cancel.pending ? <LoaderIcon className="size-3.5 animate-spin" /> : <IconStopCircle className="size-3.5" />}
			</Button>
		</Tooltip>
	);
}
