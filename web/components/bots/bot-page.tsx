/** A Bot's page, its one conversation under a header whose name shows or hides its details in the right sidebar, the card of its routines or a routine's editor in place of the conversation, and the New Bot form. */
import { BookmarkCheck } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import type { RoutineSpec } from "../../../src/routines";
import { BOT_HUES, BOT_SHAPES, type Bot, type BotId, type BotLook, REMEMBER_TOOL } from "../../../src/shared/bots";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { botAsking, type OpenBot, starterPrompts } from "../../bots-model";
import { botDraftKey, useComposerDraft } from "../../composer-drafts";
import type { Completions } from "../../pane-store";
import { type ModelList, UNREAD } from "../../reads";
import { hashForBotRoutine, hashForBots } from "../../routing";
import { draftOf, newDraft, type RoutineDraft } from "../../routines-model";
import { useAction } from "../../use-action";
import { useCompletion } from "../completion-popup";
import { useSuggestions } from "../composer-suggestions";
import { useDashboardActions } from "../dashboard-context";
import { Field, FIELD } from "../form-field";
import { PageFrame } from "../list-page";
import { ViewConversation } from "../pane";
import { Header } from "../page-header";
import type { PromptEditorHandle } from "../prompt-editor";
import { SidebarToggle } from "../sidebar-panel";
import { DirectoryPicker } from "../workspace-picker";
import { type ToolChipLabels, ToolChipsContext } from "../tool-chips";
import { RoutinesCard } from "../routines/routines-card";
import { RoutineEditor } from "../routines/routine-editor";
import { BotAvatar } from "./bot-avatar";
import { BotLookPicker } from "./bot-look-picker";

const NO_STARTERS: string[] = [];

/**
 * The composer while no omp runs the Bot's conversation: a message resumes it, or starts it when it has none, and a new Bot offers its starters.
 * Its `/` and `@` menus resolve in the Bot's workspace, as a new session's there would.
 */
function BotComposer({ bot, connected, starters, completions }: { bot: Bot; connected: boolean; starters: string[]; completions: Completions | null }) {
	const { request, send: post } = useDashboardActions();
	const editorRef = useRef<PromptEditorHandle>(null);
	const [text, setText] = useComposerDraft(botDraftKey(bot.id), "");
	const send = useAction(async (value: string) => {
		await request({ t: "bot", change: { op: "message", id: bot.id, text: value } });
		setText("");
	}, `Could not send to ${bot.name}`);
	const completion = useCompletion({
		editorRef,
		draft: text,
		setDraft: setText,
		completions,
		onComplete: (reqId, value, cursor) => post({ t: "complete", reqId, scope: { kind: "new", cwd: bot.cwd }, text: value, cursor }),
		composer: { sessionId: bot.sessionId, changed: [] },
	});
	const suggestions = useSuggestions({
		prompts: connected && !send.pending ? starters : NO_STARTERS,
		draft: text,
		onSend: value => send.run(value),
		onFill: value => {
			completion.onValueChange(value);
			requestAnimationFrame(() => editorRef.current?.select(Number.POSITIVE_INFINITY));
		},
	});
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (!completion.onMenuKeyDown(event)) suggestions.onKeyDown(event);
	};
	return (
		<div className="relative mx-auto w-full max-w-conversation px-3 pb-3">
			{completion.popup}
			<InputMessage
				editorRef={editorRef}
				value={text}
				onValueChange={completion.onValueChange}
				onSend={value => {
					if (!value) return;
					completion.close();
					send.run(value);
				}}
				editorProps={{
					...completion.editorProps,
					"aria-activedescendant": completion.editorProps["aria-activedescendant"] ?? suggestions.activeId,
					onKeyDown,
					onBlur: suggestions.onBlur,
				}}
				placeholder={`Message ${bot.name}`}
				disabled={!connected}
				sending={send.pending}
				sendLabel={`Send to ${bot.name}`}
				afterActions={suggestions.list}
			/>
		</div>
	);
}

/** The editor of a routine of `bot`, new or saved; the routine opens once the server has saved it, and a refused save says why. */
function BotRoutineEditor({ bot, initial, isNew, connected }: { bot: Bot; initial: RoutineDraft; isNew: boolean; connected: boolean }) {
	const { request } = useDashboardActions();
	// The server sends the new routines before it answers, so the routine is there when the page opens it.
	const save = useAction(async (spec: RoutineSpec) => {
		await request({ t: "routine", change: { op: "save", routine: spec } });
		location.hash = hashForBotRoutine(bot.id, { kind: "open", id: spec.id });
	}, "Could not save the routine");
	return (
		<RoutineEditor
			initial={initial}
			isNew={isNew}
			botName={bot.name}
			connected={connected}
			saving={save.pending}
			onCancel={() => (location.hash = isNew ? hashForBots(bot.id) : hashForBotRoutine(bot.id, { kind: "open", id: initial.id }))}
			onSave={spec => save.run(spec)}
		/>
	);
}

/** A new routine's editor, its id minted as it opens. */
function NewBotRoutine({ bot, connected }: { bot: Bot; connected: boolean }) {
	const [initial] = useState(() => newDraft(crypto.randomUUID(), bot.id));
	return <BotRoutineEditor bot={bot} initial={initial} isNew connected={connected} />;
}

/** In place of a routine the Bot does not have, deleted or never made, with the way back to the conversation. */
function MissingRoutine({ bot }: { bot: Bot }) {
	return (
		<PageFrame title="No such routine" meta={`${bot.name}'s routine`}>
			<div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 py-10 text-center text-sm text-pretty text-muted-foreground">
				<p>{bot.name} has no routine at this address. It may have been deleted.</p>
				<Button asChild variant="ghost" size="compact">
					<a href={hashForBots(bot.id)}>Back to {bot.name}</a>
				</Button>
			</div>
		</PageFrame>
	);
}

interface BotPageProps {
	/** The Bot, and what its page shows. */
	open: OpenBot;
	past: PastSession[];
	lastHosts: ReadonlyMap<string, RosterHost>;
	models: ReadonlyMap<string, ModelList>;
	workspaces: Workspace[];
	connected: boolean;
	/** Whether the right sidebar, which shows the Bot's details, is open. */
	detailsOpen: boolean;
	onToggleDetails: () => void;
	/** The server's last answer to a `complete` of the new-session scope, which the composer asks while the Bot's session is not running. */
	completions: Completions | null;
}

/** The Bot's header and its conversation, live, ended, or not begun, its name showing or hiding its details in the right sidebar; or the card of its routines, or the routine editor, in its place. */
export function BotPage({ open, past, lastHosts, models, workspaces, connected, detailsOpen, onToggleDetails, completions }: BotPageProps) {
	const { bot, host, view, routines, routine, status } = open;
	const instanceId = host?.instanceId ?? null;
	const toolChips = useMemo<ToolChipLabels>(() => ({ [REMEMBER_TOOL]: { label: `Updated memory for ${bot.name}`, icon: BookmarkCheck } }), [bot.name]);
	const starters = useMemo(() => (bot.sessionId === null ? starterPrompts(bot.job) : NO_STARTERS), [bot.sessionId, bot.job]);
	switch (routine.kind) {
		case "new":
			return <NewBotRoutine bot={bot} connected={connected} />;
		case "edit":
			return <BotRoutineEditor key={routine.routine.id} bot={bot} initial={draftOf(routine.routine)} isNew={false} connected={connected} />;
		case "list":
			return <RoutinesCard bot={bot} routines={routines} openId={null} connected={connected} />;
		case "open":
			return <RoutinesCard bot={bot} routines={routines} openId={routine.routine.id} connected={connected} />;
		case "missing":
			return <MissingRoutine bot={bot} />;
		case "conversation":
			break;
		default: {
			const never: never = routine;
			return never;
		}
	}
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header
				leading={<BotAvatar look={bot} size="header" working={host?.status === "working"} asking={botAsking(host) !== null} />}
				title={
					<button
						{...activityControl("bots.details")}
						type="button"
						aria-label={`${bot.name}, ${status}. ${detailsOpen ? "Hide" : "Show"} its details`}
						aria-expanded={detailsOpen}
						aria-controls="details-sidebar"
						onClick={onToggleDetails}
						className="inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="truncate">{bot.name}</span>
					</button>
				}
				end={<SidebarToggle side="right" open={detailsOpen} onToggle={onToggleDetails} />}
			/>
			<div className="relative flex min-h-0 flex-1 flex-col">
				{view ? (
					<ToolChipsContext.Provider value={toolChips}>
						<ViewConversation
							view={view}
							focused
							host={host}
							lastHost={instanceId !== null ? (lastHosts.get(instanceId) ?? null) : null}
							session={bot.sessionId !== null ? (past.find(({ sessionId }) => sessionId === bot.sessionId) ?? null) : null}
							models={(instanceId !== null && models.get(instanceId)) || UNREAD}
							workspaces={workspaces}
							header={false}
							placeholder={`Message ${bot.name}`}
						/>
					</ToolChipsContext.Provider>
				) : (
					<div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
						<BotAvatar look={bot} size="hero" />
						<p className="text-lg font-semibold text-balance">Hi, I'm {bot.name}.</p>
						<p className="text-sm text-pretty text-muted-foreground">
							{bot.job.trim()
								? "I keep one conversation with you and remember what matters. Pick a starter below, or write your own."
								: "Tell me my job: what to do, where to look, and what to ask you before acting. I'll remember it."}
						</p>
					</div>
				)}
			</div>
			{!host && <BotComposer bot={bot} connected={connected} starters={starters} completions={completions} />}
		</div>
	);
}

const randomOf = <T,>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)]!;

/** The New Bot form, as Grok's: a name, a shape and a color, and the workspace its conversation runs in, the sidebar's by default; its job comes in its first message. */
export function NewBot({ workspaces, defaultCwd, connected }: { workspaces: Workspace[]; defaultCwd: string; connected: boolean }) {
	const { changeBot } = useDashboardActions();
	const id = useId();
	const [name, setName] = useState("");
	const [look, setLook] = useState<BotLook>(() => ({ shape: randomOf(BOT_SHAPES), hue: randomOf(BOT_HUES) }));
	const [cwd, setCwd] = useState(defaultCwd);
	const [tried, setTried] = useState(false);
	const fix = !name.trim() ? "Name the Bot." : !cwd.trim() ? "Pick the workspace it works in." : null;
	return (
		<PageFrame title="New Bot" meta="A teammate with one conversation you come back to, a job, and a memory">
			<form
				className="mx-auto flex w-full max-w-sm flex-col items-center gap-6 px-6 py-10"
				onSubmit={event => {
					event.preventDefault();
					setTried(true);
					if (fix) return;
					const botId = crypto.randomUUID() as BotId;
					changeBot({ op: "save", bot: { id: botId, name: name.trim(), job: "", cwd, model: null, skill: null, ...look } });
					location.hash = hashForBots(botId);
				}}
			>
				<BotAvatar look={look} size="hero" />
				<input
					id={`${id}-name`}
					aria-label="Name"
					autoFocus
					value={name}
					placeholder="Name your Bot"
					onChange={event => setName(event.target.value)}
					className={cn(FIELD, "h-9 w-full text-center text-base")}
				/>
				<div className="w-full space-y-6">
					<BotLookPicker name={id} look={look} onLook={setLook} />
					<Field label="Workspace" hint="Its conversation runs in this directory.">
						<DirectoryPicker cwd={cwd} workspaces={workspaces} disabled={false} side="bottom" onPick={setCwd} />
					</Field>
				</div>
				<div className="flex w-full flex-col items-stretch gap-2">
					<Button type="submit" disabled={!connected}>
						Create
					</Button>
					{tried && fix && (
						<p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
							{fix}
						</p>
					)}
					<p className="text-center text-xs text-pretty text-muted-foreground">Then tell it its job in your first message.</p>
				</div>
			</form>
		</PageFrame>
	);
}
