/** `BotsGallery`, the `#bots` page: each Bot as a card with its face, name, job's first sentence, and how it stands, under Pinned, its section, or Other Bots once any Bot is pinned or in one, then a card that makes a new one. */
import { Plus } from "lucide-react";
import { useState } from "react";
import type { Routine } from "../../../src/routines";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { botAsking, botGroupKey, botGroupLabel, botGroupListName, botGroups, botRoutines, botSections, botsGrouped, botStatus, type BotRow, jobLine } from "../../bots-model";
import { mailTime } from "../../labels";
import { hashForBots, hashForNewBot } from "../../routing";
import { PageFrame } from "../list-page";
import { BotAvatar } from "./bot-avatar";
import { BotMenu, type SectionNaming, SectionNameDialog } from "./bot-menu";

const CARD = "flex min-h-52 flex-col items-center gap-2 rounded-xl border border-border p-5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4";

interface BotCardProps {
	row: BotRow;
	routineCount: number;
	sections: readonly string[];
	onName: (naming: SectionNaming) => void;
}

function BotCard({ row: { bot, host, unread, at }, routineCount, sections, onName }: BotCardProps) {
	const asking = botAsking(host);
	const tagline = jobLine(bot.job);
	const routinesWords = routineCount === 0 ? null : routineCount === 1 ? "1 routine" : `${routineCount} routines`;
	return (
		<BotMenu bot={bot} sections={sections} onName={onName} render={<li />}>
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
		</BotMenu>
	);
}

function NewBotCard() {
	return (
		<li>
			<a href={hashForNewBot()} className={cn(CARD, "h-full justify-center border-dashed text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
				<span className="flex size-16 items-center justify-center rounded-full border border-dashed border-current">
					<Plus aria-hidden className="size-6" />
				</span>
				<span className="font-medium">New Bot</span>
				<span className="text-sm text-pretty">Start from a job, or write your own.</span>
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
	const [naming, setNaming] = useState<SectionNaming | null>(null);
	const bots = rows?.map(({ bot }) => bot) ?? [];
	const sections = botSections(bots);
	const cards = (list: readonly BotRow[]) =>
		list.map(row => <BotCard key={row.bot.id} row={row} routineCount={botRoutines(routines, row.bot.id).length} sections={sections} onName={setNaming} />);
	const groups = rows !== null && botsGrouped(bots) ? botGroups(rows) : null;
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
			) : groups === null ? (
				<ul aria-label="Bots" className={cn(GRID, "mx-auto w-full max-w-5xl px-6 py-6")}>
					{cards(rows)}
					<NewBotCard />
				</ul>
			) : (
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-6">
					{groups.map((group, index) => (
						<section key={botGroupKey(group)} className="flex flex-col gap-3">
							<h2 className="text-sm font-semibold text-muted-foreground">{botGroupLabel(group)}</h2>
							<ul aria-label={botGroupListName(group)} className={GRID}>
								{cards(group.rows)}
								{index === groups.length - 1 && <NewBotCard />}
							</ul>
						</section>
					))}
				</div>
			)}
			{naming && <SectionNameDialog naming={naming} onClose={() => setNaming(null)} />}
		</PageFrame>
	);
}
