/** A Bot's routines as one card in place of its conversation, as Arc's Agent routines: a header, then a row per routine, one open at a time. */
import { ArrowLeft, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { Routine } from "../../../src/routines";
import type { Bot } from "../../../src/shared/bots";
import { Button } from "@/components/ui/button";
import { activityControl } from "../../activity";
import { hashForBotRoutine, hashForBots } from "../../routing";
import { useMinute } from "../../use-minute";
import { PageFrame } from "../list-page";
import { RoutineRow, stepIndex } from "./routine-row";

/** Arrow Up and Down, Home and End move between the routines' names. */
function moveBetweenNames(event: KeyboardEvent<HTMLUListElement>): void {
	if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-routine-name")) return;
	const names = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-routine-name]")];
	const index = stepIndex(event.key, names.indexOf(event.target), names.length, "y");
	if (index === null) return;
	event.preventDefault();
	names[index]!.focus();
}

interface RoutinesCardProps {
	bot: Bot;
	routines: Routine[];
	/** The routine whose row is open, `null` for none. */
	openId: string | null;
	connected: boolean;
}

export function RoutinesCard({ bot, routines, openId, connected }: RoutinesCardProps) {
	const now = useMinute();
	const enabled = routines.filter(routine => routine.enabled).length;
	return (
		<PageFrame
			title={bot.name}
			meta="Routines"
			actions={
				<Button asChild variant="ghost" size="compact" leadingIcon={ArrowLeft}>
					<a href={hashForBots(bot.id)}>Back to {bot.name}</a>
				</Button>
			}
		>
			<div className="px-4 py-6">
				<section aria-labelledby="routines-card-title" className="@container/card mx-auto w-full max-w-[680px] rounded-xl border border-border bg-card">
					<header className="flex items-center gap-3 border-b border-border px-4 py-3">
						<div className="min-w-0 flex-1">
							<h2 id="routines-card-title" className="text-sm font-semibold">
								Routines
							</h2>
							<p className="text-xs text-muted-foreground tabular-nums">
								{enabled} of {routines.length} on schedule
							</p>
						</div>
						<Button {...activityControl("bots.routine.new")} asChild variant="outline" size="compact" leadingIcon={Plus}>
							<a href={hashForBotRoutine(bot.id, { kind: "new" })}>New routine</a>
						</Button>
					</header>
					{routines.length === 0 ? (
						<p className="px-4 py-8 text-center text-sm text-muted-foreground">No routines yet. New routine makes one.</p>
					) : (
						<ul onKeyDown={moveBetweenNames} className="divide-y divide-border">
							{routines.map(routine => (
								<RoutineRow key={routine.id} routine={routine} botName={bot.name} open={routine.id === openId} connected={connected} now={now} />
							))}
						</ul>
					)}
				</section>
			</div>
		</PageFrame>
	);
}
