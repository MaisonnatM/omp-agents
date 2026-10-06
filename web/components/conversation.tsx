import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Delivery, Item, LiveView, PromptImage, RosterHost } from "../../src/shared";
import { InputMessage } from "@/components/ui/input-message";
import { MessageScrollerProvider, useMessageScroller } from "@/components/ui/message-scroller";
import { projectName } from "../labels";
import type { Completions } from "../pane-store";
import type { ModelList } from "../reads";
import { shortcutKeys, shortcutLabels, useShortcuts } from "../shortcuts";
import type { StartOf } from "../starts";
import { type ForkPoint, nextSuggestions } from "../transcript-view";
import type { Dashboard } from "../use-dashboard";
import { useCompletion } from "./completion-popup";
import { blockedShortcut, ComposerNote, EmptyConversation } from "./composer";
import { QueuedMessages, useQueue } from "./composer-queue";
import { useSuggestions } from "./composer-suggestions";
import { ContextRing } from "./context-ring";
import { ConversationHeader } from "./conversation-header";
import { AttachButton, IMAGE_ACCEPT, useImageAttachments } from "./image-attachments";
import type { ModelMenuOpen } from "./model-picker";
import { ModelSlot } from "./model-slot";
import { type Subject, subjectOf } from "./subject";
import { Transcript } from "./transcript";
import { UserRequestCard } from "./user-request";

const FOLLOW_UP_KEYS = shortcutKeys("followUp");

interface ConversationProps {
	view: LiveView;
	/** Current roster row, or `null` once the session has left the roster. */
	host: RosterHost | null;
	/** Last known row, for the header after the session ended. */
	lastHost: RosterHost | null;
	items: Item[];
	/** Whether `items` arrived, so an empty list is a conversation with no messages and not one still loading. */
	loaded: boolean;
	/** Composer text on mount, from a fork. */
	initialDraft: string;
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	completions: Completions | null;
	/** The last model list the server sent for this session; nothing while none has arrived. */
	models: ModelList;
	/** The server's last answer to this view's `dequeue`. */
	dequeued: { reqId: number; texts: string[] } | null;
	send: Dashboard["send"];
	/** End running session `instanceId`, as the header's End session and its shortcut do. */
	onEnd: (instanceId: string) => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
	/** Whether this is the focused pane, the one session shortcuts act on. */
	focused: boolean;
}

/** One live session or subagent: header, live transcript, composer. Keyed by view, so drafts, queues, and scroll reset per view. */
export function Conversation(props: ConversationProps) {
	return (
		<MessageScrollerProvider autoScroll>
			<LiveConversation {...props} />
		</MessageScrollerProvider>
	);
}

function placeholderOf({ writable, working, followUps, agent, phase }: Subject): string {
	if (!writable) return phase.phase === "live" && agent && !agent.canMessage ? "This subagent cannot be messaged." : "Messaging is unavailable for this view.";
	if (working) return `Steer ${agent ? "this subagent" : "the running turn"}…${followUps ? ` ${FOLLOW_UP_KEYS} sends once it finishes` : ""}`;
	if (agent) return agent.status === "parked" ? "Message to revive this subagent…" : "Message this subagent…";
	return "Message this session…";
}

function LiveConversation({
	view,
	host,
	lastHost,
	items,
	loaded,
	initialDraft,
	fork,
	onFork,
	completions,
	models,
	dequeued,
	send,
	onEnd,
	actions,
	focused,
}: ConversationProps) {
	const { scrollToEnd } = useMessageScroller();
	const [draft, setDraft] = useState(initialDraft);
	const [modelsOpen, setModelsOpen] = useState<ModelMenuOpen | null>(null);
	const [pendingModelRevision, setPendingModelRevision] = useState<number | null>(null);
	const attachments = useImageAttachments();

	const subject = subjectOf(view, host, lastHost);
	const { shown, agent, writable, attachable, working, requests, shell } = subject;
	const session = subject.kind === "session";
	const switchable = subject.kind === "session" ? subject.switchable : null;
	const thinking = shown?.thinkingLevel ?? null;
	useEffect(() => {
		if (!subject.live) setPendingModelRevision(null);
	}, [subject.live]);
	const switchingModel = !!switchable && (switchable.modelSwitch.pending || pendingModelRevision === switchable.modelSwitch.revision);
	const instanceId = view.instanceId;
	const editPrompt = useCallback((entryId: string, text: string) => send({ t: "edit-prompt", instanceId, entryId, text }), [instanceId, send]);

	const textarea = () => completion.composerRef.current?.querySelector("textarea");
	const { queued, take } = useQueue({
		waiting: subject.queue,
		dequeued,
		dequeue: (reqId, messages) => send({ t: "dequeue", reqId, view, messages }),
		restore: text => {
			setDraft(current => (current ? `${text}\n${current}` : text));
			textarea()?.focus();
		},
	});
	// The focused pane's composer takes the keyboard once it can be typed in: when the view opens, and when it goes live.
	useEffect(() => {
		if (focused && writable) textarea()?.focus();
	}, [writable]);
	// As omp's Esc does, the session's queued messages come back into the composer instead of running after the interrupt.
	const interrupt = (): void => {
		take(queued, true);
		send({ t: "abort", instanceId: view.instanceId });
	};

	const submit = (text: string, delivery: Delivery): void => {
		const prompt = (images: PromptImage[]): void => send({ t: "prompt", view, text, images, delivery });
		completion.close();
		setDraft("");
		scrollToEnd();
		if (!attachable) return prompt([]);
		attachments.take(prompt, () => setDraft(current => current || text));
	};
	const sendText = (text: string): void => {
		if (blockedShortcut(text, shell) === null) submit(text, "steer");
	};

	const directCommand = blockedShortcut(draft, shell);
	// What the finished turn suggests sending next, offered once nothing else waits on the user. Filtered to none the composer would hold back.
	const turnSuggestions = useMemo(() => nextSuggestions(items, working), [items, working]);
	const suggestions = useSuggestions({
		prompts: writable && requests.length === 0 ? turnSuggestions.filter(text => blockedShortcut(text, shell) === null) : [],
		draft,
		onSend: sendText,
		onFill: text => {
			completion.onValueChange(text);
			requestAnimationFrame(() => {
				const el = textarea();
				if (!el) return;
				el.focus();
				el.setSelectionRange(el.value.length, el.value.length);
			});
		},
	});

	// The list refreshes on every open, whether a click or the model shortcut opened the menu.
	const openModels = (open: ModelMenuOpen | null): void => {
		if (open !== null && modelsOpen === null) send({ t: "list-models", instanceId: view.instanceId });
		setModelsOpen(open);
	};
	const setThinking = (level: string): void => send({ t: "set-thinking", instanceId: view.instanceId, level });

	const onComposerKey = useShortcuts({
		// The textarea's own keys, so they need no focused pane.
		followUp: () => {
			const text = draft.trim();
			if (!writable || !subject.followUps || (!text && (!attachable || attachments.files.length === 0)) || directCommand) return false;
			submit(text, "followUp");
		},
		// Enter with a draft still steers. On the empty composer, the server stops the turn if omp still holds a steer, so omp runs it now.
		deliverSteer: () => {
			if (!session || !writable || !working || draft.trim() !== "" || (attachable && attachments.files.length > 0)) return false;
			send({ t: "flush", instanceId: view.instanceId });
		},
		...(focused
			? {
					interrupt: () => {
						if (!session || !writable || !working) return false;
						interrupt();
					},
					endSession: () => {
						if (!session || !subject.live) return false;
						onEnd(view.instanceId);
					},
					// As ↑ edits the last message in a chat app; with a draft, ↑ keeps moving the caret.
					dequeue: () => {
						if (draft !== "") return false;
						// omp takes back its last steer before its last follow-up.
						const last = queued.findLast(entry => entry.queue === "steering") ?? queued.at(-1);
						return take(last ? [last] : [], true);
					},
					model: () => {
						if (!switchable) return false;
						openModels("models");
					},
					thinking: () => {
						const levels = switchingModel ? [] : switchable?.thinkingLevels ?? [];
						if (levels.length === 0) return false;
						setThinking(levels[(levels.indexOf(thinking ?? "") + 1) % levels.length]);
					},
					focusComposer: () => {
						const el = textarea();
						if (!el || el.disabled) return false;
						el.focus();
					},
				}
			: {}),
	});
	const completion = useCompletion({
		draft,
		setDraft,
		completions,
		onComplete: (reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "live", view }, text, cursor }),
		onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
			onComposerKey(event);
			if (!event.defaultPrevented) suggestions.onKeyDown(event);
		},
	});

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<ConversationHeader view={view} subject={subject} onEnd={onEnd} actions={actions} />
			<Transcript
				view={view}
				items={items}
				working={working}
				fork={fork}
				onFork={onFork}
				onEdit={switchable ? editPrompt : undefined}
				empty={
					loaded &&
					session &&
					writable &&
					shown && (
						<EmptyConversation title="No messages yet">
							omp is running in {projectName(shown.cwdDisplay) ?? shown.cwdDisplay}. Send a message to start its first turn.
						</EmptyConversation>
					)
				}
			/>
			<div className="relative mx-auto w-full max-w-3xl px-3 pb-5">
				{requests[0] && (
					<UserRequestCard
						key={requests[0].id}
						request={requests[0]}
						queued={requests.length - 1}
						onAnswer={answer => send({ t: "answer", instanceId: view.instanceId, requestId: requests[0].id, answer })}
					/>
				)}
				{completion.popup}
				<InputMessage
					ref={completion.composerRef}
					value={draft}
					onValueChange={completion.onValueChange}
					textareaProps={{
						...completion.textareaProps,
						"aria-activedescendant": completion.textareaProps["aria-activedescendant"] ?? suggestions.activeId,
						onBlur: suggestions.onBlur,
					}}
					onSend={sendText}
					leftSlot={
						<ModelSlot
							subject={subject}
							models={models}
							open={modelsOpen}
							onOpenChange={openModels}
							switching={switchingModel}
							onBeginSwitch={() => {
								if (switchable) setPendingModelRevision(switchable.modelSwitch.revision);
							}}
							onSetModel={(model, level) => send({ t: "set-model", instanceId: view.instanceId, model, thinking: level })}
							onSetThinking={setThinking}
							onSetFast={enabled => send({ t: "set-fast", instanceId: view.instanceId, enabled })}
						/>
					}
					files={attachable ? attachments.files : undefined}
					onFilesChange={attachable ? attachments.onFilesChange : undefined}
					accept={IMAGE_ACCEPT}
					rightSlot={({ openFilePicker }) => (
						<>
							{session && shown?.context && <ContextRing context={shown.context} />}
							{attachable && <AttachButton onClick={() => openFilePicker()} />}
						</>
					)}
					placeholder={placeholderOf(subject)}
					disabled={!writable}
					// While a turn runs, Enter and the send button steer it, and Stop interrupts a session's turn.
					status={working ? "streaming" : "idle"}
					onStop={session ? interrupt : undefined}
					stopShortcut={shortcutLabels("interrupt")}
					sendLabel={`${working ? "Steer" : "Send to"} ${agent ? "subagent" : "session"}`}
					beforeTextarea={<QueuedMessages entries={queued} onEdit={entry => take([entry], true)} onRemove={entry => take([entry], false)} />}
					afterActions={suggestions.list}
				/>
				{directCommand && <ComposerNote text={directCommand} />}
				{attachable && attachments.note && <ComposerNote text={attachments.note} />}
			</div>
		</div>
	);
}
