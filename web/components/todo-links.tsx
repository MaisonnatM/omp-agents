import { Bot, X } from "lucide-react";
import { hashForSession, type PastSession, type RosterHost, type UserTodoLink } from "../../src/shared";
import { hostLabel, pastLabel } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { hashForInbox, hashForTickets } from "../routing";
import type { TodoWorkState } from "../todo-work-state";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusDot } from "./status-dot";

/** The live and past sessions, which name a linked session and tell whether it still runs. */
export interface KnownSessions {
	hosts: RosterHost[];
	past: PastSession[];
}

function sessionLabel(sessionId: string, { hosts, past }: KnownSessions): { name: string; host: RosterHost | null } {
	const host = hosts.find(h => h.sessionId === sessionId) ?? null;
	const saved = host ? undefined : past.find(session => session.sessionId === sessionId);
	return { name: host ? hostLabel(host) : saved ? pastLabel(saved) : "Session", host };
}

/** Where a link goes in this dashboard, and what it reads as. */
function linkTarget(link: UserTodoLink, sessions: KnownSessions) {
	switch (link.kind) {
		case "session": {
			const { name, host } = sessionLabel(link.sessionId, sessions);
			return { href: hashForSession(link.sessionId), label: name, title: host ? `Session ${name}, ${host.status}` : `Session ${name}, ended`, host };
		}
		case "pull-request":
			return { href: hashForInbox(link), label: `${link.repo}#${link.number}`, title: `Pull request ${link.owner}/${link.repo}#${link.number}`, host: null };
		case "ticket":
			return { href: hashForTickets(link.identifier), label: link.identifier, title: `Linear issue ${link.identifier}`, host: null };
		default: {
			const never: never = link;
			return never;
		}
	}
}

/** Each link shows the icon of the page it opens. */
const ICONS = { session: PAGE_ICON.sessions, "pull-request": PAGE_ICON.inbox, ticket: PAGE_ICON.tickets } as const;

interface TodoLinkChipProps {
	link: UserTodoLink;
	sessions: KnownSessions;
	/** Takes the link off the todo; without it, the chip has no remove button. */
	onRemove?: () => void;
}

/** One thing a todo points to, linking to it in this dashboard; a running session shows its status dot. */
export function TodoLinkChip({ link, sessions, onRemove }: TodoLinkChipProps) {
	const { href, label, title, host } = linkTarget(link, sessions);
	const Icon = ICONS[link.kind];
	return (
		<span className="inline-flex max-w-56 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
			<Tooltip content={title}>
				<a href={href} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground [&>svg]:size-3 [&>svg]:shrink-0">
					{host ? <StatusDot status={host.status} /> : <Icon />}
					<span className="truncate">{label}</span>
				</a>
			</Tooltip>
			{onRemove && (
				<Tooltip content="Unlink">
					<button type="button" aria-label={`Unlink ${label}`} onClick={onRemove} className="hover:text-foreground [&>svg]:size-3">
						<X />
					</button>
				</Tooltip>
			)}
		</span>
	);
}

const WORK_LABELS: Record<TodoWorkState["kind"], { label: string; color: string }> = {
	idea: { label: "Idea", color: "bg-muted-foreground" },
	working: { label: "Agent working", color: "bg-sky-500" },
	"needs-you": { label: "Needs you", color: "bg-amber-500" },
	"in-review": { label: "In review", color: "bg-violet-500" },
	shipped: { label: "Shipped", color: "bg-emerald-500" },
	ended: { label: "Session ended", color: "bg-muted-foreground" },
	unavailable: { label: "Session unavailable", color: "bg-muted-foreground" },
};

export function TodoWorkPill({ state }: { state: TodoWorkState }) {
	if (state.kind === "idea") return null;
	const { label, color } = WORK_LABELS[state.kind];
	return (
		<Tooltip content={`${label}. Open session`}>
			<a href={hashForSession(state.sessionId)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
				<span className={`size-1.5 rounded-full ${color}`} aria-hidden />
				{label}
			</a>
		</Tooltip>
	);
}

/** The session whose agent added a todo, linking to it. */
export function AddedByChip({ sessionId, sessions }: { sessionId: string; sessions: KnownSessions }) {
	const { name } = sessionLabel(sessionId, sessions);
	return (
		<Tooltip content={`Added by the agent of ${name}`}>
			<a href={hashForSession(sessionId)} className="inline-flex max-w-48 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground [&>svg]:size-3 [&>svg]:shrink-0">
				<Bot />
				<span className="truncate">{name}</span>
			</a>
		</Tooltip>
	);
}
