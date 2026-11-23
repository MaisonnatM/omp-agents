/** The pieces the Board's page and its sidebar list share: times, a ticking clock, member avatars, and the dialog that names a new channel or thread. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Member } from "../../../src/shared/board";
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

export const MIN = 60_000;
export const UNITS: Record<string, number> = { m: MIN, h: 60 * MIN, d: 24 * 60 * MIN };

export function relTime(at: number, now: number): string {
	const delta = at - now;
	const abs = Math.abs(delta);
	if (abs < MIN) return "now";
	const unit = abs < UNITS.h! ? `${Math.round(abs / MIN)}m` : abs < UNITS.d! ? `${Math.round(abs / UNITS.h!)}h` : `${Math.round(abs / UNITS.d!)}d`;
	return delta > 0 ? `in ${unit}` : unit;
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
