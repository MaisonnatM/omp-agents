/** `SessionChip`, a small chip naming a session on a pull request or issue, and `LiveSessionsMenu`, a dropdown of the sessions on an item. */
import { Bot, ChevronDown } from "lucide-react";
import type { MouseEvent } from "react";
import type { HostStatus, RosterHost, View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuShortcut } from "@/components/ui/menu";
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
	/** Shows the session's status alone, naming it in the tooltip, where its name would not fit whole. */
	compact?: boolean;
	onClick: (event: MouseEvent) => void;
}

/** A session named on a pull request or an issue, which opens it on click. */
export function SessionChip({ label, status, title, filled, compact = false, onClick }: SessionChipProps) {
	return (
		<Tooltip content={`${label}. ${title}`}>
			<button
				type="button"
				onClick={onClick}
				className={cn(
					"flex max-w-48 min-w-0 items-center gap-1.5 rounded px-1.5 py-px text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
					filled ? "bg-muted" : "ring-1 ring-inset ring-border",
					compact && "gap-1 px-1",
				)}
			>
				{compact && <Bot aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
				{status && <StatusDot status={status} />}
				<span className={compact ? "sr-only" : "truncate"}>{label}</span>
			</button>
		</Tooltip>
	);
}

/** A button naming how many running sessions work on an item, whose menu lists them to open; nothing when none does. */
export function LiveSessionsMenu({ hosts, onOpen }: { hosts: RosterHost[]; onOpen: (view: View, mode: OpenMode) => void }) {
	if (hosts.length === 0) return null;
	const count = `${hosts.length} ${hosts.length === 1 ? "session" : "sessions"}`;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="secondary" size="compact" leadingIcon={Bot} trailingIcon={ChevronDown} aria-label={`${count} working on it`} />}>
				<span className="tabular-nums">{count}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-w-80">
				{hosts.map(host => (
					<MenuItem key={host.instanceId} title={`${statusLabel(host.status)}. ${SPLIT_CLICK} to split`} onClick={event => onOpen({ kind: "live", instanceId: host.instanceId, agentId: null }, modeOf(event))}>
						<StatusDot status={host.status} />
						<span className="min-w-0 flex-1 truncate">{hostLabel(host)}</span>
						<MenuShortcut>{SPLIT_CLICK}</MenuShortcut>
					</MenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
