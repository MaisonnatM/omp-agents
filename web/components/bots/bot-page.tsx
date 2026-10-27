/** A Bot's page, its one conversation under a header whose name opens its job, memory, and routines, and the New Bot form. */
import { BookmarkCheck, ChevronDown, CircleStop, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { Routine } from "../../../src/routines";
import { type Bot, type BotId, type BotSpec, MAX_JOB_LENGTH, REMEMBER_TOOL } from "../../../src/shared/bots";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { botHost, botRoutines, botView, memoryEntries, starterPrompts } from "../../bots-model";
import { type ModelList, UNREAD } from "../../reads";
import { hashForBots, hashForRoutines, hashForView } from "../../routing";
import { schedulesWords } from "../../routines-model";
import { useAction } from "../../use-action";
import { useSuggestions } from "../composer-suggestions";
import { type ConversationChrome, ConversationChromeContext } from "../conversation-chrome";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { Field, FIELD, TEXT_AREA } from "../form-field";
import { PageFrame } from "../list-page";
import { ViewConversation } from "../pane";
import { Header } from "../page-header";
import type { PromptEditorHandle } from "../prompt-editor";
import { statusLabel } from "../status-dot";
import { DirectoryPicker } from "../workspace-picker";
import { BotAvatar } from "./bot-avatar";

const NO_STARTERS: string[] = [];

const specOf = ({ id, name, job, cwd, model, skill }: Bot): BotSpec => ({ id, name, job, cwd, model, skill });

/** **Delete**, which asks first in its place; the Bot's conversation stays a session of yours. */
function DeleteBot({ bot, connected }: { bot: Bot; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const [confirming, setConfirming] = useState(false);
	if (confirming) {
		return (
			<div role="group" aria-label={`Delete ${bot.name}?`} className="flex shrink-0 items-center gap-2 text-xs">
				<span>Delete {bot.name}? Its conversation stays in your sessions.</span>
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
		);
	}
	return (
		<Button {...activityControl("bots.delete")} variant="ghost" size="compact" leadingIcon={Trash2} disabled={!connected} onClick={() => setConfirming(true)}>
			Delete
		</Button>
	);
}

/** The composer while no omp runs the Bot's conversation: a message resumes it, or starts it when it has none, and a new Bot offers its starters. */
function BotComposer({ bot, connected, starters }: { bot: Bot; connected: boolean; starters: string[] }) {
	const { request } = useDashboardActions();
	const editorRef = useRef<PromptEditorHandle>(null);
	const [text, setText] = useState("");
	const send = useAction(async (value: string) => {
		await request({ t: "bot", change: { op: "message", id: bot.id, text: value } });
		setText("");
	}, `Could not send to ${bot.name}`);
	const suggestions = useSuggestions({
		prompts: connected && !send.pending ? starters : NO_STARTERS,
		draft: text,
		onSend: value => send.run(value),
		onFill: value => {
			setText(value);
			requestAnimationFrame(() => editorRef.current?.select(Number.POSITIVE_INFINITY));
		},
	});
	return (
		<div className="mx-auto w-full max-w-conversation px-3 pb-3">
			<InputMessage
				editorRef={editorRef}
				value={text}
				onValueChange={setText}
				onSend={value => value && send.run(value)}
				editorProps={{ "aria-activedescendant": suggestions.activeId, onKeyDown: suggestions.onKeyDown, onBlur: suggestions.onBlur }}
				placeholder={`Message ${bot.name}`}
				disabled={!connected}
				sending={send.pending}
				sendLabel={`Send to ${bot.name}`}
				afterActions={suggestions.list}
			/>
		</div>
	);
}

/** The Bot's job, which every turn's system prompt carries, saved when you say so. */
function JobEditor({ bot, connected }: { bot: Bot; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const id = useId();
	const [draft, setDraft] = useState(bot.job);
	const dirty = draft !== bot.job;
	return (
		<section aria-labelledby={id} className="space-y-2">
			<h3 id={id} className="text-xs font-medium text-muted-foreground">
				Job
			</h3>
			<textarea
				aria-labelledby={id}
				value={draft}
				rows={6}
				maxLength={MAX_JOB_LENGTH}
				placeholder="What it does for you, and what it asks before doing."
				onChange={event => setDraft(event.target.value)}
				className={TEXT_AREA}
			/>
			{dirty && (
				<div className="flex items-center gap-2">
					<Button size="compact" disabled={!connected} onClick={() => changeBot({ op: "save", bot: { ...specOf(bot), job: draft.trim() } })}>
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

/** The routines that send their prompt into the Bot's conversation. */
function BotRoutines({ bot, routines }: { bot: Bot; routines: readonly Routine[] }) {
	const id = useId();
	const targeting = botRoutines(routines, bot.id);
	return (
		<section aria-labelledby={id} className="space-y-2">
			<h3 id={id} className="text-xs font-medium text-muted-foreground">
				Routines
			</h3>
			{targeting.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No routine writes to {bot.name}. Pick it as a routine's target on the{" "}
					<a href={hashForRoutines(null)} className="underline underline-offset-2">
						Routines page
					</a>
					.
				</p>
			) : (
				<ul className="space-y-1.5">
					{targeting.map(routine => (
						<li key={routine.id}>
							<a
								href={hashForRoutines(routine.id)}
								className="block rounded-md border border-border bg-card px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className={cn("block truncate font-medium", !routine.enabled && "text-muted-foreground")}>{routine.name}</span>
								<span className="block truncate text-xs text-muted-foreground">
									{routine.enabled ? schedulesWords(routine.schedules) : "Paused"} · Runs into this conversation
								</span>
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

interface BotPageProps {
	bot: Bot;
	/** Its `memory.md`, empty while it remembers nothing. */
	memory: string;
	routines: readonly Routine[];
	/** Every session, since a Bot's workspace may be one the sidebar hides. */
	hosts: RosterHost[];
	past: PastSession[];
	lastHosts: ReadonlyMap<string, RosterHost>;
	models: ReadonlyMap<string, ModelList>;
	workspaces: Workspace[];
	connected: boolean;
}

/** The Bot's details, which its name in the header opens: where it works, its job, memory, and routines, then End session while it runs and Delete. */
function BotDetails({ bot, host, memory, routines, connected }: { bot: Bot; host: RosterHost | null; memory: string; routines: readonly Routine[]; connected: boolean }) {
	const { end } = useDashboardActions();
	const { ending } = useDashboardStatus();
	const status = host ? statusLabel(host.status) : bot.sessionId ? "not running" : "no conversation yet";
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					{...activityControl("bots.details")}
					type="button"
					aria-label={`${bot.name}, ${status}. Show its details`}
					className="flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
				>
					<span className="truncate">{bot.name}</span>
					<ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" collisionPadding={8} aria-label={`About ${bot.name}`} className="max-h-(--radix-popover-content-available-height) w-96 max-w-[calc(100vw-2rem)] space-y-5 overflow-y-auto p-4">
				<div className="flex items-center gap-3">
					<BotAvatar id={bot.id} size="sheet" working={host?.status === "working"} asking={host?.status === "needs-input"} />
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">{bot.name}</p>
						<p className="truncate font-mono text-xs text-muted-foreground" title={bot.cwd}>
							{bot.cwd}
						</p>
					</div>
				</div>
				<JobEditor key={bot.job} bot={bot} connected={connected} />
				<MemoryList bot={bot} memory={memory} />
				<BotRoutines bot={bot} routines={routines} />
				<div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
					{host && (
						<Button variant="ghost" size="compact" leadingIcon={CircleStop} loading={ending.has(host.instanceId)} disabled={!connected} onClick={() => end(host.instanceId)}>
							End session
						</Button>
					)}
					<DeleteBot bot={bot} connected={connected} />
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** The Bot's header and its conversation, live, ended, or not begun, with its details behind its name. */
export function BotPage({ bot, memory, routines, hosts, past, lastHosts, models, workspaces, connected }: BotPageProps) {
	const host = botHost(bot, hosts);
	const instanceId = host?.instanceId ?? null;
	const conversation = botView(bot, hosts);
	// Keyed by its address, since botView builds a new view on each render.
	const pane = conversation && hashForView(conversation);
	const view = useMemo(() => conversation, [pane]);
	const chrome = useMemo<ConversationChrome>(
		() => ({ placeholder: `Message ${bot.name}`, toolChips: { [REMEMBER_TOOL]: { label: `Updated memory for ${bot.name}`, icon: BookmarkCheck } } }),
		[bot.name],
	);
	const starters = useMemo(() => (bot.sessionId === null ? starterPrompts(bot.job) : NO_STARTERS), [bot.sessionId, bot.job]);
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header
				leading={<BotAvatar id={bot.id} size="header" working={host?.status === "working"} asking={host?.status === "needs-input"} />}
				title={<BotDetails bot={bot} host={host} memory={memory} routines={routines} connected={connected} />}
			/>
			<div className="relative flex min-h-0 flex-1 flex-col">
				{view ? (
					<ConversationChromeContext.Provider value={chrome}>
						<ViewConversation
							view={view}
							focused
							host={host}
							lastHost={instanceId !== null ? (lastHosts.get(instanceId) ?? null) : null}
							session={bot.sessionId !== null ? (past.find(({ sessionId }) => sessionId === bot.sessionId) ?? null) : null}
							models={(instanceId !== null && models.get(instanceId)) || UNREAD}
							workspaces={workspaces}
							resumable={false}
						/>
					</ConversationChromeContext.Provider>
				) : (
					<div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
						<BotAvatar id={bot.id} size="hero" />
						<p className="text-lg font-semibold text-balance">Hi, I'm {bot.name}.</p>
						<p className="text-sm text-pretty text-muted-foreground">I keep one conversation with you and remember what matters. Pick a starter below, or write your own.</p>
					</div>
				)}
			</div>
			{!host && <BotComposer bot={bot} connected={connected} starters={starters} />}
		</div>
	);
}

/** The New Bot form: its name and job, then the workspace its conversation runs in, the sidebar's by default. */
export function NewBot({ workspaces, defaultCwd, connected }: { workspaces: Workspace[]; defaultCwd: string; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const id = useId();
	const [name, setName] = useState("");
	const [cwd, setCwd] = useState(defaultCwd);
	const [job, setJob] = useState("");
	const [tried, setTried] = useState(false);
	const fix = !name.trim() ? "Name the Bot." : !cwd.trim() ? "Pick the workspace it works in." : null;
	return (
		<PageFrame title="New Bot" meta="A teammate with one conversation you come back to, a job, and a memory">
			<form
				className="mx-auto w-full max-w-2xl space-y-6 px-6 py-6"
				onSubmit={event => {
					event.preventDefault();
					setTried(true);
					if (fix) return;
					const botId = crypto.randomUUID() as BotId;
					changeBot({ op: "save", bot: { id: botId, name: name.trim(), job: job.trim(), cwd, model: null, skill: null } });
					location.hash = hashForBots(botId);
				}}
			>
				<Field label="Name" htmlFor={`${id}-name`}>
					<input id={`${id}-name`} autoFocus value={name} placeholder="Scout" onChange={event => setName(event.target.value)} className={cn(FIELD, "w-full")} />
				</Field>
				<Field label="Job" htmlFor={`${id}-job`} hint="Every turn's system prompt carries it. You can change it later.">
					<textarea
						id={`${id}-job`}
						value={job}
						rows={6}
						maxLength={MAX_JOB_LENGTH}
						placeholder="Watch the main branch's CI and tell me what broke. Ask before you push."
						onChange={event => setJob(event.target.value)}
						className={TEXT_AREA}
					/>
				</Field>
				<Field label="Workspace" hint="Its conversation runs in this directory.">
					<DirectoryPicker cwd={cwd} workspaces={workspaces} disabled={false} side="bottom" onPick={setCwd} />
				</Field>
				<div className="flex items-center gap-3 border-t border-border pt-4">
					<Button type="submit" disabled={!connected}>
						Create Bot
					</Button>
					{tried && fix && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							{fix}
						</p>
					)}
				</div>
			</form>
		</PageFrame>
	);
}
