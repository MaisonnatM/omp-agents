/** `BotsGallery`, the `#bots` page: each Bot as a card with its face, name, job's first sentence, and how it stands, then a card that makes a new one. */
import { Plus } from "lucide-react";
import type { Routine } from "../../../src/routines";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { botAsking, botRoutines, botStatus, type BotRow, jobLine } from "../../bots-model";
import { mailTime } from "../../labels";
import { hashForBots, hashForNewBot } from "../../routing";
import { PageFrame } from "../list-page";
import { BotAvatar } from "./bot-avatar";

const CARD = "flex min-h-52 flex-col items-center gap-2 rounded-xl border border-border p-5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring";

function BotCard({ row: { bot, host, unread, at }, routineCount }: { row: BotRow; routineCount: number }) {
	const asking = botAsking(host);
	const tagline = jobLine(bot.job);
	const routinesWords = routineCount === 0 ? null : routineCount === 1 ? "1 routine" : `${routineCount} routines`;
	return (
		<li>
			<a href={hashForBots(bot.id)} className={cn(CARD, "h-full bg-card hover:bg-accent/50")}>
				<span className="relative">
					<BotAvatar look={bot} size="hero" working={host?.status === "working"} asking={asking !== null} />
					{unread && <span aria-label="Unread" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" />}
				</span>
				<span className="mt-1 max-w-full truncate font-semibold">{bot.name}</span>
				<span className={cn("line-clamp-2 text-sm text-pretty", tagline ? "text-muted-foreground" : "text-muted-foreground/70 italic")}>{tagline || "No job yet"}</span>
				<span className="mt-auto flex max-w-full items-center gap-1.5 pt-2 text-xs text-muted-foreground">
					<span className={cn("truncate first-letter:uppercase", asking && "text-amber-700 dark:text-amber-400")}>{asking ?? botStatus(bot, host)}</span>
					{routinesWords && (
						<>
							<span aria-hidden>·</span>
							<span className="shrink-0">{routinesWords}</span>
						</>
					)}
					<span aria-hidden>·</span>
					<time dateTime={new Date(at).toISOString()} className="shrink-0 tabular-nums">
						{mailTime(at)}
					</time>
				</span>
			</a>
		</li>
	);
}

interface BotsGalleryProps {
	/** `null` until the server sends the Bots. */
	rows: readonly BotRow[] | null;
	routines: readonly Routine[];
}

export function BotsGallery({ rows, routines }: BotsGalleryProps) {
	return (
		<PageFrame
			title="Bots"
			meta="Teammates with one conversation you come back to, a job, and a memory"
			actions={
				<Button asChild size="compact" leadingIcon={Plus}>
					<a href={hashForNewBot()}>New Bot</a>
				</Button>
			}
		>
			{rows === null ? (
				<p className="px-6 py-6 text-sm text-muted-foreground">Loading your Bots…</p>
			) : (
				<ul aria-label="Bots" className="mx-auto grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 px-6 py-6">
					{rows.map(row => (
						<BotCard key={row.bot.id} row={row} routineCount={botRoutines(routines, row.bot.id).length} />
					))}
					<li>
						<a href={hashForNewBot()} className={cn(CARD, "h-full justify-center border-dashed text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
							<span className="flex size-16 items-center justify-center rounded-full border border-dashed border-current">
								<Plus aria-hidden className="size-6" />
							</span>
							<span className="font-medium">New Bot</span>
							<span className="text-sm text-pretty">Start from a job, or write your own.</span>
						</a>
					</li>
				</ul>
			)}
		</PageFrame>
	);
}
