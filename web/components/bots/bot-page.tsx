/** A Bot's page, its one conversation under a header whose name shows or hides its details in the right sidebar, a routine's settings and runs or editor in place of the conversation, and the New Bot form. */
import { BookmarkCheck } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { Routine } from "../../../src/routines";
import { BOT_HUES, BOT_SHAPES, type Bot, type BotId, type BotLook, REMEMBER_TOOL } from "../../../src/shared/bots";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { botHost, botView, starterPrompts } from "../../bots-model";
import { type ModelList, UNREAD } from "../../reads";
import { hashForBotRoutine, hashForBots, hashForView, NEW_ROUTINE } from "../../routing";
import { draftOf, newDraft, type RoutineDraft } from "../../routines-model";
import { useAction } from "../../use-action";
import { useSuggestions } from "../composer-suggestions";
import { useDashboardActions } from "../dashboard-context";
import { Field, FIELD } from "../form-field";
import { PageFrame } from "../list-page";
import { ViewConversation } from "../pane";
import { Header } from "../page-header";
import type { PromptEditorHandle } from "../prompt-editor";
import { SidebarToggle } from "../sidebar-panel";
import { statusLabel } from "../status-dot";
import { DirectoryPicker } from "../workspace-picker";
import { type ToolChipLabels, ToolChipsContext } from "../tool-chips";
import { RoutineDetail } from "../routines/routine-detail";
import { RoutineEditor } from "../routines/routine-editor";
import { BotAvatar } from "./bot-avatar";
import { BotLookPicker } from "./bot-look-picker";

const NO_STARTERS: string[] = [];

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

interface BotPageProps {
	bot: Bot;
	/** The Bot's routine whose settings and runs show in place of the conversation, {@link NEW_ROUTINE} for a new one's editor, `null` for the conversation. */
	routine: string | null;
	/** Every routine, the Bot's among them. */
	routines: readonly Routine[];
	/** Every session, since a Bot's workspace may be one the sidebar hides. */
	hosts: RosterHost[];
	past: PastSession[];
	lastHosts: ReadonlyMap<string, RosterHost>;
	models: ReadonlyMap<string, ModelList>;
	workspaces: Workspace[];
	connected: boolean;
	/** Whether the right sidebar, which shows the Bot's details, is open. */
	detailsOpen: boolean;
	onToggleDetails: () => void;
}

/** The Bot's header and its conversation, live, ended, or not begun, its name showing or hiding its details in the right sidebar; or one of its routines, or the routine editor, in its place. */
export function BotPage({ bot, routine, routines, hosts, past, lastHosts, models, workspaces, connected, detailsOpen, onToggleDetails }: BotPageProps) {
	const { send } = useDashboardActions();
	const [editing, setEditing] = useState<RoutineDraft | null>(null);
	// The route remounts the page, so a new routine's id holds while its editor shows.
	const [created] = useState(() => newDraft(crypto.randomUUID(), bot.id));
	const own = useMemo(() => routines.filter(({ botId }) => botId === bot.id), [routines, bot.id]);
	const host = botHost(bot, hosts);
	const instanceId = host?.instanceId ?? null;
	const conversation = botView(bot, hosts);
	// Keyed by its address, since botView builds a new view on each render.
	const pane = conversation && hashForView(conversation);
	const view = useMemo(() => conversation, [pane]);
	const toolChips = useMemo<ToolChipLabels>(() => ({ [REMEMBER_TOOL]: { label: `Updated memory for ${bot.name}`, icon: BookmarkCheck } }), [bot.name]);
	const starters = useMemo(() => (bot.sessionId === null ? starterPrompts(bot.job) : NO_STARTERS), [bot.sessionId, bot.job]);
	const isNew = routine === NEW_ROUTINE;
	if (editing || isNew) {
		return (
			<RoutineEditor
				initial={editing ?? created}
				isNew={isNew}
				botName={bot.name}
				connected={connected}
				onCancel={() => (isNew ? (location.hash = hashForBots(bot.id)) : setEditing(null))}
				onSave={spec => {
					send({ t: "routine", change: { op: "save", routine: spec } });
					setEditing(null);
					location.hash = hashForBotRoutine(bot.id, spec.id);
				}}
			/>
		);
	}
	// A routine just saved shows once the server sends it back, and the conversation until then.
	const shown = routine === null ? undefined : own.find(({ id }) => id === routine);
	if (shown) return <RoutineDetail routine={shown} botName={bot.name} connected={connected} onEdit={() => setEditing(draftOf(shown))} />;
	const status = host ? statusLabel(host.status) : bot.sessionId ? "not running" : "no conversation yet";
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header
				leading={<BotAvatar look={bot} size="header" working={host?.status === "working"} asking={host?.status === "needs-input"} />}
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
			{!host && <BotComposer bot={bot} connected={connected} starters={starters} />}
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
