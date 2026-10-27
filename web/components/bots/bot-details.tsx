/** `BotDetails`, the right sidebar on a Bot's page: its look and name, both editable in place, where it works, its job, memory, and routines, then End session and Delete. */
import { CircleStop, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { Routine } from "../../../src/routines";
import { type Bot, type BotSpec, MAX_JOB_LENGTH } from "../../../src/shared/bots";
import type { RosterHost } from "../../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { botAsking, memoryEntries, type OpenBot, type OpenRoutine } from "../../bots-model";
import { hashForBotRoutine, hashForBots } from "../../routing";
import { startsWords } from "../../routines-model";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { TEXT_AREA } from "../form-field";
import { RunDot } from "../routines/routine-marks";
import { BotAvatar } from "./bot-avatar";
import { BotLookPicker } from "./bot-look-picker";

const botSpec = ({ id, name, job, cwd, model, skill, shape, hue }: Bot): BotSpec => ({ id, name, job, cwd, model, skill, shape, hue });

/** **Delete**, which asks first in its place; the Bot's routines go with it, and its conversation stays a session of yours. */
function DeleteBot({ bot, connected }: { bot: Bot; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const [confirming, setConfirming] = useState(false);
	if (confirming) {
		return (
			<div role="group" aria-label={`Delete ${bot.name}?`} className="space-y-2 text-xs">
				<p>Delete {bot.name}? Its routines are deleted too, and its conversation stays in your sessions.</p>
				<div className="flex items-center gap-2">
					<Button
						size="compact"
						disabled={!connected}
						onClick={() => {
							changeBot({ op: "remove", id: bot.id });
							location.hash = hashForBots(null);
						}}
					>
						Delete Bot
					</Button>
					<Button variant="ghost" size="compact" autoFocus onClick={() => setConfirming(false)}>
						Cancel
					</Button>
				</div>
			</div>
		);
	}
	return (
		<Button {...activityControl("bots.delete")} variant="ghost" size="compact" leadingIcon={Trash2} disabled={!connected} onClick={() => setConfirming(true)}>
			Delete
		</Button>
	);
}

/** The Bot's avatar, which opens its shape and color, each saved as you pick it. */
function LookButton({ bot, host, connected }: { bot: Bot; host: RosterHost | null; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const id = useId();
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					{...activityControl("bots.look")}
					type="button"
					aria-label={`Change ${bot.name}'s shape and color`}
					className="shrink-0 rounded-xl p-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
				>
					<BotAvatar look={bot} size="hero" working={host?.status === "working"} asking={botAsking(host) !== null} />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" collisionPadding={8} aria-label={`${bot.name}'s shape and color`} className="w-auto max-w-72 p-3">
				<BotLookPicker name={id} look={bot} disabled={!connected} onLook={look => changeBot({ op: "save", bot: { ...botSpec(bot), ...look } })} />
			</PopoverContent>
		</Popover>
	);
}

/** The Bot's name, edited in place: Enter or leaving the field saves it, and Escape puts it back. */
function NameField({ bot, connected }: { bot: Bot; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const [draft, setDraft] = useState(bot.name);
	const save = (): void => {
		const name = draft.trim();
		if (!name) setDraft(bot.name);
		else if (name !== bot.name) changeBot({ op: "save", bot: { ...botSpec(bot), name } });
	};
	return (
		<input
			aria-label="Name"
			value={draft}
			disabled={!connected}
			onChange={event => setDraft(event.target.value)}
			onBlur={save}
			onKeyDown={event => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					setDraft(bot.name);
					const input = event.currentTarget;
					requestAnimationFrame(() => input.blur());
				}
			}}
			className="-mx-1.5 w-[calc(100%+0.75rem)] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold outline-none hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
		/>
	);
}

/** The Bot's job, which every turn's system prompt carries, saved when you say so. */
function JobEditor({ bot, connected }: { bot: Bot; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const id = useId();
	const [draft, setDraft] = useState(bot.job);
	const dirty = draft.trim() !== bot.job;
	return (
		<section aria-labelledby={id} className="space-y-2">
			<h3 id={id} className="text-xs font-medium text-muted-foreground">
				Job
			</h3>
			<textarea
				aria-labelledby={id}
				value={draft}
				rows={5}
				maxLength={MAX_JOB_LENGTH}
				placeholder={`What ${bot.name} does for you, and what it asks before doing. Or tell it in the conversation.`}
				onChange={event => setDraft(event.target.value)}
				className={TEXT_AREA}
			/>
			{dirty && (
				<div className="flex items-center gap-2">
					<Button size="compact" disabled={!connected} onClick={() => changeBot({ op: "save", bot: { ...botSpec(bot), job: draft.trim() } })}>
						Save job
					</Button>
					<Button {...activityControl("bots.job.revert")} variant="ghost" size="compact" onClick={() => setDraft(bot.job)}>
						Revert
					</Button>
				</div>
			)}
		</section>
	);
}

/** The facts the Bot keeps, which only its `remember` tool writes. */
function MemoryList({ bot, memory }: { bot: Bot; memory: string }) {
	const id = useId();
	const entries = memoryEntries(memory);
	return (
		<section aria-labelledby={id} className="space-y-2">
			<h3 id={id} className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
				Memory
				<span className="truncate font-mono font-normal">bots/{bot.id}/memory.md</span>
			</h3>
			{entries.length === 0 ? (
				<p className="text-xs text-muted-foreground">Nothing yet. Tell {bot.name} something worth keeping, and it remembers it.</p>
			) : (
				<ul className="space-y-1.5">
					{entries.map((entry, index) => (
						<li key={index} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
							<p className="break-words">{entry.fact}</p>
							{entry.date && <p className="text-xs tabular-nums text-muted-foreground">{entry.date}</p>}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** The Bot's routines, each opening its settings and runs in place of the conversation, and **New routine**; `open` is what the page shows, which they mark. */
function BotRoutines({ bot, routines, open, connected }: { bot: Bot; routines: readonly Routine[]; open: OpenRoutine; connected: boolean }) {
	const openId = open.kind === "open" || open.kind === "edit" ? open.routine.id : null;
	const id = useId();
	return (
		<section aria-labelledby={id} className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<h3 id={id} className="text-xs font-medium text-muted-foreground">
					Routines
				</h3>
				{connected ? (
					<Button {...activityControl("bots.routine.new")} asChild variant="ghost" size="compact" leadingIcon={Plus}>
						<a href={hashForBotRoutine(bot.id, { kind: "new" })} aria-current={open.kind === "new" ? "page" : undefined}>
							New routine
						</a>
					</Button>
				) : (
					<Button variant="ghost" size="compact" leadingIcon={Plus} disabled>
						New routine
					</Button>
				)}
			</div>
			{routines.length === 0 ? (
				<p className="text-xs text-muted-foreground">No routine yet. A routine messages {bot.name} or runs a command in its workspace on its schedules, its triggers, or both.</p>
			) : (
				<ul className="space-y-1.5">
					{routines.map(routine => (
						<li key={routine.id}>
							<a
								href={hashForBotRoutine(bot.id, { kind: "open", id: routine.id })}
								aria-current={openId === routine.id ? "page" : undefined}
								className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent"
							>
								<RunDot run={routine.runs[0]} />
								<span className="min-w-0">
									<span className={cn("block truncate font-medium", !routine.enabled && "text-muted-foreground")}>{routine.name}</span>
									<span className="block truncate text-xs text-muted-foreground">{routine.enabled ? startsWords(routine) : "Paused"}</span>
								</span>
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

interface BotDetailsProps {
	/** The Bot, and what its page shows. */
	open: OpenBot;
	/** Its `memory.md`, empty while it remembers nothing. */
	memory: string;
	connected: boolean;
}

export function BotDetails({ open: { bot, host, routines, routine, status }, memory, connected }: BotDetailsProps) {
	const { end } = useDashboardActions();
	const { ending } = useDashboardStatus();
	return (
		<>
			<SidebarHeader className="h-(--page-header-height) flex-row items-center border-b border-border px-4 py-0">
				<h2 className="text-sm font-semibold">Details</h2>
			</SidebarHeader>
			<SidebarContent>
				<div className="space-y-6 p-4">
					<div className="flex items-center gap-3">
						<LookButton bot={bot} host={host} connected={connected} />
						<div className="min-w-0 flex-1">
							<NameField key={bot.name} bot={bot} connected={connected} />
							<p className="truncate text-xs text-muted-foreground first-letter:uppercase">{status}</p>
							<p className="truncate font-mono text-xs text-muted-foreground" title={bot.cwd}>
								{bot.cwd}
							</p>
						</div>
					</div>
					<JobEditor key={bot.job} bot={bot} connected={connected} />
					<MemoryList bot={bot} memory={memory} />
					<BotRoutines bot={bot} routines={routines} open={routine} connected={connected} />
					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
						{host && (
							<Button variant="ghost" size="compact" leadingIcon={CircleStop} loading={ending.has(host.instanceId)} disabled={!connected} onClick={() => end(host.instanceId)}>
								End session
							</Button>
						)}
						<DeleteBot bot={bot} connected={connected} />
					</div>
				</div>
			</SidebarContent>
		</>
	);
}
