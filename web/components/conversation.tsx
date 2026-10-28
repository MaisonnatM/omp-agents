import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelOption } from "../../src/shared/models";
import type { Delivery, LiveView, RosterHost } from "../../src/shared/sessions";
import type { ChangedFile } from "../../src/shared/transcript";
import type { Workspace } from "../../src/shared/workspaces";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { MessageScrollerProvider, useMessageScroller } from "@/components/ui/message-scroller";
import { Tooltip } from "@/components/ui/tooltip";
import { liveDraftKey, useComposerDraft } from "../composer-drafts";
import { folderName, hostLabel } from "../labels";
import { useChangedFiles, useComposerData, useNextSuggestions } from "../pane-store";
import type { ModelList } from "../reads";
import { shortcutKeys, shortcutLabels, useShortcuts } from "../shortcuts";
import type { StartOf } from "../starts";
import type { ForkPoint } from "../transcript-view";
import { useAction } from "../use-action";
import type { Dashboard } from "../use-dashboard";
import type { ScheduleWhen } from "../scheduled-model";
import { AskAboutSelection } from "./ask-about-selection";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerEditor, ComposerNote, DirectoryLabel, EmptyConversation } from "./composer";
import { QueuedMessages, useQueue } from "./composer-queue";
import { useSuggestions } from "./composer-suggestions";
import type { PromptEditorHandle } from "./prompt-editor";
import { ContextRing } from "./context-ring";
import { ConversationHeader } from "./conversation-header";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ATTACH_ACCEPT, AttachButton, usePromptAttachments } from "./prompt-attachments";
import type { ModelMenuOpen } from "./model-picker";
import { ModelSlot } from "./model-slot";
import { ScheduleButton, ScheduledMessages, useScheduleSend } from "./scheduled";
import { deliveryOf, type Subject, subjectOf } from "./subject";
import { PromptHistoryButton } from "./prompt-history";
import { Trajectory } from "./trajectory";
import { Transcript } from "./transcript";
import { UserRequestCard } from "./user-request";
import { DirectoryPicker } from "./workspace-picker";

const STEER_KEYS = shortcutKeys("steer");

/** The changed files before the server sent any, one array so the composer's menu is not rebuilt for it. */
const NO_FILES: ChangedFile[] = [];

interface ConversationProps {
	view: LiveView;
	/** Current roster row, or `null` once the session has left the roster. */
	host: RosterHost | null;
	/** Last known row, for the header after the session ended. */
	lastHost: RosterHost | null;
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	/** The last model list the server sent for this session; nothing while none has arrived. */
	models: ModelList;
	send: Dashboard["send"];
	/** End running session `instanceId`, as the header's End session and its shortcut do. */
	onEnd: (instanceId: string) => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
	/** A control the page puts right after the title, such as the trajectory switch. */
	titleAction?: ReactNode;
	/** Show its turns in place of its transcript; the composer stays. */
	trajectory: boolean;
	/** Whether this is the focused pane, the one session shortcuts act on. */
	focused: boolean;
	/** The workspaces, as {@link listWorkspaces} lists them, which the directory picker offers. */
	workspaces: Workspace[];
	/** Draw the session's header, with End session and its shortcut; a Bot's page draws its own, and a Bot's session never ends from the page. */
	header: boolean;
	/** The composer's placeholder while the session waits on a message, in place of "Message this session…". */
	placeholder?: string;
}

/** One live session or subagent: header, live transcript, composer. Keyed by view: its draft is kept per view, in this browser, while queues and scroll reset per view. */
export function Conversation(props: ConversationProps) {
	return (
		<MessageScrollerProvider autoScroll>
			<LiveConversation {...props} />
		</MessageScrollerProvider>
	);
}

function placeholderOf({ writable, working, followUps, agent, phase }: Subject, idle = "Message this session…"): string {
	if (!writable) return phase.phase === "live" && agent && !agent.canMessage ? "This subagent cannot be messaged." : "Messaging is unavailable for this view.";
	if (working) {
		const target = agent ? "this subagent" : "the running turn";
		return followUps ? `Queue a follow-up… ${STEER_KEYS} steers ${target} now` : `Steer ${target}…`;
	}
	if (agent) return agent.status === "parked" ? "Message to revive this subagent…" : "Message this subagent…";
	return idle;
}

function LiveConversation({
	view,
	host,
	lastHost,
	fork,
	onFork,
	models,
	send,
	onEnd,
	actions,
	titleAction,
	trajectory,
	focused,
	workspaces,
	header,
	placeholder,
}: ConversationProps) {
	const { scrollToEnd } = useMessageScroller();
	const editorRef = useRef<PromptEditorHandle>(null);
	const { completions, withdrawn } = useComposerData(view);
	const changed = useChangedFiles(view) ?? NO_FILES;
	const [draft, setDraft] = useComposerDraft(liveDraftKey(view), "");
	const [modelsOpen, setModelsOpen] = useState<ModelMenuOpen | null>(null);
	const [directoriesOpen, setDirectoriesOpen] = useState(false);
	const subject = subjectOf(view, host, lastHost);
	const { shown, agent, writable, working, requests, shell } = subject;
	const attachments = usePromptAttachments(subject.images);

	const session = subject.kind === "session";
	const switchable = subject.kind === "session" ? subject.switchable : null;
	const thinking = shown?.thinkingLevel ?? null;
	const instanceId = view.instanceId;
	const { request } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const scheduleSend = useScheduleSend();
	const editPrompt = useCallback((entryId: string, text: string) => request({ t: "edit-prompt", instanceId, entryId, text }), [instanceId, request]);
	const completion = useCompletion({
		editorRef,
		draft,
		setDraft,
		completions,
		onComplete: (reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "live", view }, text, cursor }),
		composer: { sessionId: shown?.sessionId ?? null, changed },
	});

	const stop = useAction((reqId: number) => request({ t: "interrupt", reqId, view }), "Could not stop the turn");
	const modelChange = useAction((model: ModelOption, level: string | null) => request({ t: "set-model", instanceId, model, thinking: level }), "Could not switch the model");
	const thinkingChange = useAction((level: string) => request({ t: "set-thinking", instanceId, level }), "Could not change the thinking level");
	const fastChange = useAction((enabled: boolean) => request({ t: "set-fast", instanceId, enabled }), "Could not switch fast mode");
	const switching = (!!switchable && switchable.switching) || modelChange.pending || thinkingChange.pending || fastChange.pending;
	const restoreDraft = (text: string): void => {
		setDraft(current => (current ? `${text}\n${current}` : text));
		editorRef.current?.focus();
	};
	const { queued, take, interrupt } = useQueue({
		waiting: subject.queue,
		withdrawn,
		dequeue: (reqId, queue, text) => send({ t: "dequeue", reqId, view, queue, text }),
		interrupt: stop.run,
		restore: messages => {
			restoreDraft(messages.map(message => message.text).join("\n"));
			attachments.restore(messages.flatMap(message => message.images));
		},
	});
	// The focused pane's composer takes the keyboard once it can be typed in: when the view opens, and when it goes live, not when focus moves.
	const focusedNow = useRef(focused);
	focusedNow.current = focused;
	useEffect(() => {
		if (focusedNow.current && writable) editorRef.current?.focus();
	}, [writable]);

	const submit = (text: string, delivery: Delivery): void => {
		completion.close();
		setDraft("");
		scrollToEnd();
		void attachments.take(text, (prompt, images) => request({ t: "prompt", view, text: prompt, images, delivery }), () => setDraft(current => current || text));
	};
	const sendText = (text: string): void => {
		if (blockedShortcut(text, shell) === null) submit(text, deliveryOf(subject));
	};
	// The discussion keeps this past later renders, so it reads the delivery the session takes when you send, not when you asked.
	const latestSubject = useRef(subject);
	latestSubject.current = subject;
	const sendToSession = useCallback((text: string) => request({ t: "prompt", view, text, images: [], delivery: deliveryOf(latestSubject.current) }), [request, view]);

	const directCommand = blockedShortcut(draft, shell);
	const steerable = writable && (draft.trim() !== "" || attachments.files.length > 0) && !directCommand;
	const steerDraft = (): void => submit(draft.trim(), "steer");
	const sessionId = session ? (shown?.sessionId ?? null) : null;
	const schedule = useAction(async (when: ScheduleWhen) => {
		const text = draft.trim();
		if (sessionId === null) return;
		await scheduleSend({ kind: "message", sessionId, text }, when);
		setDraft(current => (current.trim() === text ? "" : current));
	}, "Could not schedule the message");
	// What the finished turn suggests sending next, offered once nothing else waits on the user. Filtered to none the composer would hold back.
	const turnSuggestions = useNextSuggestions(view, working);
	const suggestions = useSuggestions({
		prompts: writable && requests.length === 0 ? turnSuggestions.filter(text => blockedShortcut(text, shell) === null) : [],
		draft,
		onSend: sendText,
		onFill: text => {
			completion.onValueChange(text);
			requestAnimationFrame(() => editorRef.current?.select(Number.POSITIVE_INFINITY));
		},
	});

	// The list refreshes on every open, whether a click or the model shortcut opened the menu.
	const openModels = (open: ModelMenuOpen | null): void => {
		if (open !== null && modelsOpen === null) send({ t: "list-models", instanceId: view.instanceId });
		setModelsOpen(open);
	};
	// omp's `/move` refuses while a turn runs, a turn waiting on a question included.
	const movable = switchable?.status === "idle";

	const onComposerKey = useShortcuts({
		// The text field's own keys, so they need no focused pane.
		steer: () => {
			if (!steerable) return false;
			steerDraft();
		},
		// On the empty composer, the server stops the turn if omp still holds a steer, so omp runs it now.
		deliverSteer: () => {
			if (!session || !writable || !working || draft.trim() !== "" || attachments.files.length > 0) return false;
			send({ t: "flush", instanceId: view.instanceId });
		},
		...(focused
			? {
					interrupt: () => {
						if (!session || !writable || !working || stop.pending) return false;
						interrupt();
					},
					endSession: () => {
						if (!header || !session || !subject.live) return false;
						onEnd(view.instanceId);
					},
					// As ↑ edits the last message in a chat app; with a draft, ↑ keeps moving the caret.
					dequeue: () => {
						if (draft !== "") return false;
						// omp takes back its last steer before its last follow-up.
						return take(queued.findLast(entry => entry.queue === "steering") ?? queued.at(-1), true);
					},
					model: () => {
						if (!switchable) return false;
						openModels("models");
					},
					directory: () => {
						if (!movable) return false;
						setDirectoriesOpen(open => !open);
					},
					thinking: () => {
						const levels = switching ? [] : switchable?.thinkingLevels ?? [];
						if (levels.length === 0) return false;
						thinkingChange.run(levels[(levels.indexOf(thinking ?? "") + 1) % levels.length]);
					},
					focusComposer: () => {
						const editor = editorRef.current;
						if (!editor?.editable()) return false;
						editor.focus();
					},
				}
			: {}),
	});
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (completion.onMenuKeyDown(event)) return;
		onComposerKey(event);
		if (!event.defaultPrevented) suggestions.onKeyDown(event);
		if (!event.defaultPrevented && event.key === "Escape") {
			event.currentTarget.blur();
			event.preventDefault();
		}
	};
	const cwdDisplay = shown?.cwdDisplay;
	// Kept across renders, so the memoized transcript does not render again for each keystroke in the composer.
	const empty = useMemo(
		() =>
			session && writable && cwdDisplay !== undefined ? (
				<EmptyConversation title="No messages yet">
					omp is running in {folderName(cwdDisplay) ?? cwdDisplay}. Send a message to start its first turn.
				</EmptyConversation>
			) : undefined,
		[session, writable, cwdDisplay],
	);
	const changes = useMemo(() => ({ sessionId, cwd: shown?.cwd ?? null, facts: shown }), [sessionId, shown]);

	return (
		<div className="@container/conversation flex h-full min-h-0 flex-1 flex-col" data-conversation>
			{header && <ConversationHeader view={view} subject={subject} onEnd={onEnd} actions={actions} titleAction={titleAction} />}
			{trajectory ? (
				<Trajectory view={view} />
			) : (
				<AskAboutSelection origin={{ source: shown ? `session “${hostLabel(shown)}”` : "a session", sendToSession: writable ? sendToSession : null }}>
					<Transcript view={view} working={working} fork={fork} onFork={onFork} onEdit={switchable ? editPrompt : undefined} empty={empty} changes={changes} />
				</AskAboutSelection>
			)}
			<div className="conversation-lane relative px-3 pb-3">
				{requests[0] && (
					<UserRequestCard
						key={requests[0].id}
						request={requests[0]}
						queued={requests.length - 1}
						onAnswer={answer => request({ t: "answer", instanceId: view.instanceId, requestId: requests[0].id, answer })}
						shortcuts={focused}
					/>
				)}
				{completion.popup}
				<ComposerEditor value={editorRef}>
					<InputMessage
						editorRef={editorRef}
						value={draft}
						onValueChange={completion.onValueChange}
						editorProps={{
							...completion.editorProps,
							"aria-activedescendant": completion.editorProps["aria-activedescendant"] ?? suggestions.activeId,
							onKeyDown,
							onBlur: suggestions.onBlur,
						}}
						onSend={sendText}
						leftSlot={
							<>
								{shown &&
									(switchable ? (
										<DirectoryPicker
											cwd={shown.cwdDisplay}
											workspaces={workspaces}
											disabled={!movable}
											tooltip={movable ? shown.cwdDisplay : `${shown.cwdDisplay} · Move the session once the turn ends`}
											shortcut="directory"
											open={directoriesOpen}
											onOpenChange={setDirectoriesOpen}
											onPick={dir => send({ t: "prompt", view, text: `/move ${dir}`, images: [], delivery: "steer" })}
											control="composer.directory"
										/>
									) : (
										<DirectoryLabel cwd={shown.cwdDisplay} />
									))}
								<ModelSlot
									subject={subject}
									models={models}
									open={modelsOpen}
									onOpenChange={openModels}
									switching={switching}
									onSetModel={modelChange.run}
									onSetThinking={thinkingChange.run}
									onSetFast={fastChange.run}
								/>
							</>
						}
						files={writable ? attachments.files : undefined}
						onFilesChange={writable ? attachments.onFilesChange : undefined}
						accept={ATTACH_ACCEPT}
						rightSlot={({ openFilePicker }) => (
							<>
								{working && subject.followUps && steerable && (
									<Tooltip content={`Steer ${agent ? "the subagent" : "the running turn"} now instead of queueing`} shortcut={shortcutLabels("steer")} side="top">
										<Button variant="ghost" size="sm" onClick={steerDraft}>
											Send now
										</Button>
									</Tooltip>
								)}
								{session && shown?.context && <ContextRing context={shown.context} />}
								{sessionId !== null && writable && (
									<ScheduleButton draft={draft} files={attachments.files.length} disabled={!connected} pending={schedule.pending} onSchedule={schedule.run} />
								)}
								{!trajectory && <PromptHistoryButton view={view} />}
								{writable && <AttachButton onClick={() => openFilePicker()} />}
							</>
						)}
						placeholder={placeholderOf(subject, placeholder)}
						disabled={!writable}
						status={working ? "streaming" : "idle"}
						onStop={session ? interrupt : undefined}
						stopping={stop.pending}
						stopShortcut={shortcutLabels("interrupt")}
						sendLabel={working && subject.followUps ? "Queue a follow-up" : `${working ? "Steer" : "Send to"} ${agent ? "subagent" : "session"}`}
						beforeEditor={
							<>
								<ScheduledMessages sessionId={sessionId} onEdit={restoreDraft} />
								<QueuedMessages
									entries={queued}
									onSendNow={entry =>
										send(entry.queue === "followUp" ? { t: "promote", view, text: entry.item.text } : { t: "flush", instanceId: view.instanceId })
									}
									onEdit={entry => take(entry, true)}
									onRemove={entry => take(entry, false)}
								/>
							</>
						}
						afterActions={suggestions.list}
					/>
				</ComposerEditor>
				{directCommand && <ComposerNote text={directCommand} />}
				{writable && attachments.note && <ComposerNote text={attachments.note} />}
			</div>
		</div>
	);
}
