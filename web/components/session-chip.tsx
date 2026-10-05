import { Bot } from "lucide-react";
import type { MouseEvent } from "react";
import type { HostStatus, RosterHost, View } from "../../src/shared";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hostLabel, modeOf, SPLIT_CLICK } from "../labels";
import type { OpenMode } from "../routing";
import { StatusDot, statusLabel } from "./status-dot";

interface SessionChipProps {
	label: string;
	/** A running session's status, which its dot shows; `null` for a past session. */
	status: HostStatus | null;
	title: string;
	/** Filled for the session that submitted the pull request, outlined for one that worked on it. */
	filled: boolean;
	onClick: (event: MouseEvent) => void;
}

/** A session named on a pull request or an issue, which opens it on click. */
export function SessionChip({ label, status, title, filled, onClick }: SessionChipProps) {
	return (
		<Tooltip content={`${label}. ${title}`}>
			<button
				type="button"
				onClick={onClick}
				className={cn(
					"flex max-w-48 items-center gap-1.5 rounded px-1.5 py-px text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
					filled ? "bg-muted" : "ring-1 ring-inset ring-border",
				)}
			>
				{status && <StatusDot status={status} />}
				<span className="truncate">{label}</span>
			</button>
		</Tooltip>
	);
}

/** The running sessions that work on an item, each with its status; nothing when none does. */
export function LiveSessionChips({ hosts, onOpen }: { hosts: RosterHost[]; onOpen: (view: View, mode: OpenMode) => void }) {
	if (hosts.length === 0) return null;
	return (
		<div role="group" aria-label="Sessions working on it" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
			<Bot aria-hidden className="size-4 shrink-0 text-muted-foreground" />
			{hosts.map(host => (
				<SessionChip
					key={host.instanceId}
					label={hostLabel(host)}
					status={host.status}
					title={`A session works on it, ${statusLabel(host.status)}. Open the session (${SPLIT_CLICK} to split)`}
					filled={false}
					onClick={event => onOpen({ kind: "live", instanceId: host.instanceId, agentId: null }, modeOf(event))}
				/>
			))}
		</div>
	);
}
