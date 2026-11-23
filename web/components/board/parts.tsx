/** The pieces the Board's page and its sidebar list share: times, a ticking clock, member avatars, chips, and the dialog that names a new channel or thread. */
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DAY, HOUR, type Member, MIN, type Thread } from "../../../src/shared/board";
import { BotAvatar } from "../bots/bot-avatar";
import { useDashboardStatus } from "../dashboard-context";
import { FormDialog, FormDialogHeader } from "../form-dialog";
import { FIELD } from "../form-field";

/** Asks for one name, such as a new channel's or a new thread's title, and hands it trimmed to `onSave`; `refuse` says why a name cannot be used. */
export function NameDialog({ title, label, refuse, onSave, onClose }: { title: string; label: string; refuse?: (name: string) => string | null; onSave: (name: string) => void; onClose: () => void }) {
	const { connected } = useDashboardStatus();
	const [name, setName] = useState("");
	const trimmed = name.trim();
	const refused = trimmed ? (refuse?.(trimmed) ?? null) : null;
	const ready = trimmed !== "" && refused === null && connected;
	return (
		<FormDialog busy={false} onClose={onClose} className="top-[20%] w-[min(24rem,calc(100vw-2rem))]">
			<FormDialogHeader title={title} busy={false} />
			<form
				className="flex flex-col gap-3 px-4 pt-3 pb-4"
				onSubmit={event => {
					event.preventDefault();
					if (!ready) return;
					onSave(trimmed);
					onClose();
				}}
			>
				<input aria-label={label} autoFocus placeholder={label} value={name} onChange={event => setName(event.target.value)} className={cn(FIELD, "h-8 w-full")} />
				{refused && <p className="text-xs text-red-600 dark:text-red-400">{refused}</p>}
				<div className="flex justify-end">
					<Button type="submit" size="compact" disabled={!ready}>
						Create
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}

export function relTime(at: number, now: number): string {
	const delta = at - now;
	const abs = Math.abs(delta);
	if (abs < MIN) return "now";
	const unit = abs < HOUR ? `${Math.round(abs / MIN)}m` : abs < DAY ? `${Math.round(abs / HOUR)}h` : `${Math.round(abs / DAY)}d`;
	return delta > 0 ? `in ${unit}` : unit;
}

/** The session feed's `@you waits on you: ` or `@you finished: ` lead, which `src/server/board-feed.ts` writes so the post counts as a mention. */
const FEED_LEAD = /^@.+? (waits on you|finished): /;

/** A session feed post's status and the text after its lead, `null` for any other message; a reply the feed cut mid-bold drops its unpaired `**`, which would show raw. */
export function feedLead(text: string): { label: string; tone: "green" | "amber"; body: string } | null {
	const lead = FEED_LEAD.exec(text);
	if (!lead) return null;
	const rest = text.slice(lead[0].length);
	const body = (rest.match(/\*\*/g)?.length ?? 0) % 2 === 0 ? rest : rest.replaceAll("**", "");
	return lead[1] === "finished" ? { label: "Finished", tone: "green", body } : { label: "Waits on you", tone: "amber", body };
}

export function Chip({ children, tone, title }: { children: ReactNode; tone?: "blue" | "green" | "amber" | "violet"; title?: string }) {
	const tones = { blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300", green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300", violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300" };
	return <span title={title} className={cn("inline-block h-5 min-w-0 truncate rounded px-1.5 text-2xs leading-5 font-medium", tone ? tones[tone] : "bg-foreground/[0.06] text-muted-foreground")}>{children}</span>;
}

/** Who holds a lease and for how long, or that it ran out. */
export function leaseLabel(lease: NonNullable<Thread["lease"]>, byId: ReadonlyMap<string, Member>, now: number, sep: string) {
	return `${byId.get(lease.by)?.name ?? lease.by}${sep}${leaseLeft(lease, now)}`;
}

const leaseLeft = (lease: NonNullable<Thread["lease"]>, now: number): string => (lease.until <= now ? "lease expired" : `${relTime(lease.until, now).replace("in ", "")} left`);

const TASK_TONE = { open: "blue", claimed: "violet", review: "amber", done: "green" } as const;

/** The task's state, and for a claim how long it has left; the holder's name, often a long session title, shows on hover and in the thread's details. */
export function TaskChip({ thread, byId, now }: { thread: Thread; byId: ReadonlyMap<string, Member>; now: number }) {
	if (!thread.task) return null;
	const lease = thread.task === "claimed" ? thread.lease : null;
	return (
		<Chip tone={TASK_TONE[thread.task]} title={lease ? leaseLabel(lease, byId, now, " · ") : undefined}>
			{lease ? `claimed · ${leaseLeft(lease, now)}` : thread.task}
		</Chip>
	);
}

export function useNow(ms = 15_000) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(id);
	}, [ms]);
	return now;
}

export const PRESENCE_COLOR: Record<Member["presence"], string> = {
	working: "bg-sky-500",
	idle: "bg-emerald-500",
	online: "bg-emerald-500",
	asking: "bg-amber-500",
	away: "bg-zinc-400",
	asleep: "bg-zinc-400",
};

/** `dot: false` leaves out the presence dot, as in an overlapping stack, where it would sit on the next avatar. */
export function Avatar({ member, size, dot = true }: { member: Member; size: "xs" | "sm" | "md"; dot?: boolean }) {
	const box = size === "xs" ? "size-4" : size === "sm" ? "size-6" : "size-8";
	return (
		<span className={cn("relative inline-flex shrink-0", box)}>
			{member.kind === "human" ? (
				<span
					className={cn("grid size-full place-items-center rounded-full text-[0.7rem] font-semibold text-white", size === "md" && "text-xs", size === "xs" && "text-[0.45rem]")}
					style={{ background: `oklch(0.62 0.13 ${member.look.hue})` }}
				>
					{member.initials}
				</span>
			) : (
				// No bob in the 16px sidebar slot, where it reads as the icon sitting off its row.
				<BotAvatar look={member.look} size={size === "md" ? "row" : "header"} working={size !== "xs" && member.presence === "working"} className={size === "md" ? "size-8" : size === "xs" ? "size-4" : undefined} />
			)}
			{dot && <span className={cn("absolute -right-0.5 -bottom-0.5 rounded-full", size === "xs" ? "size-1.5 ring-1 ring-sidebar" : "size-2.5 ring-2 ring-background", PRESENCE_COLOR[member.presence], member.presence === "working" && "motion-safe:animate-pulse")} />}
		</span>
	);
}
