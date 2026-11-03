/** `SubagentLinks`, where a live view's subagents open and stop, and `CancelAgentButton`, the stop button after a running subagent's link. */
import { CircleStop } from "lucide-react";
import { createContext } from "react";
import type { AgentRow, LiveView, View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import type { OpenMode } from "../routing";
import { useAction } from "../use-action";

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
				{cancel.pending ? <LoaderIcon className="size-3.5 animate-spin" /> : <CircleStop className="size-3.5" />}
			</Button>
		</Tooltip>
	);
}
