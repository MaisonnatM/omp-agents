import { Bot, GitPullRequest, MessageSquare, Ticket, X } from "lucide-react";
import { hashForSession, type PastSession, type RosterHost, type UserTodoLink } from "../../src/shared";
import { hostLabel, pastLabel } from "../labels";
import { hashForInbox, hashForTickets } from "../routing";
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

const ICONS = { session: MessageSquare, "pull-request": GitPullRequest, ticket: Ticket } as const;

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
			<a href={href} title={title} className="inline-flex min-w-0 items-center gap-1 hover:text-foreground [&>svg]:size-3 [&>svg]:shrink-0">
				{host ? <StatusDot status={host.status} /> : <Icon />}
				<span className="truncate">{label}</span>
			</a>
			{onRemove && (
				<button type="button" aria-label={`Unlink ${label}`} title="Unlink" onClick={onRemove} className="hover:text-foreground [&>svg]:size-3">
					<X />
				</button>
			)}
		</span>
	);
}

/** The session whose agent added a todo, linking to it. */
export function AddedByChip({ sessionId, sessions }: { sessionId: string; sessions: KnownSessions }) {
	const { name } = sessionLabel(sessionId, sessions);
	return (
		<a
			href={hashForSession(sessionId)}
			title={`Added by the agent of ${name}`}
			className="inline-flex max-w-48 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground [&>svg]:size-3 [&>svg]:shrink-0"
		>
			<Bot />
			<span className="truncate">{name}</span>
		</a>
	);
}
