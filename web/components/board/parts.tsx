/** The pieces the Board's page and its sidebar list share: times, a ticking clock, and member avatars. */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Member } from "../../../src/shared/board";
import { BotAvatar } from "../bots/bot-avatar";

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

export function Avatar({ member, size }: { member: Member; size: "xs" | "sm" | "md" }) {
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
				<BotAvatar look={member.look} size={size === "md" ? "row" : "header"} working={member.presence === "working"} className={size === "md" ? "size-8" : size === "xs" ? "size-4" : undefined} />
			)}
			<span className={cn("absolute -right-0.5 -bottom-0.5 rounded-full", size === "xs" ? "size-1.5 ring-1 ring-sidebar" : "size-2.5 ring-2 ring-background", PRESENCE_COLOR[member.presence], member.presence === "working" && "motion-safe:animate-pulse")} />
		</span>
	);
}
