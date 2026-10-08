import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../src/shared/projects";
import type { Delivery, LiveView, PromptImage, RosterHost } from "../../src/shared/sessions";
import type { ChangedFile } from "../../src/shared/transcript";
import { InputMessage } from "@/components/ui/input-message";
import { MessageScrollerProvider, useMessageScroller } from "@/components/ui/message-scroller";
import { projectName } from "../labels";
import { useChangedFiles, useComposerData, useNextSuggestions } from "../pane-store";
import type { ModelList } from "../reads";
import { shortcutKeys, shortcutLabels, useShortcuts } from "../shortcuts";
import type { StartOf } from "../starts";
import type { ForkPoint } from "../transcript-view";
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
	/** Composer text on mount, from a fork. */
	initialDraft: string;
	fork: StartOf<"fork"> | null;
	onFork: (itemId: string, point: ForkPoint) => void;
	/** The last model list the server sent for this session; nothing while none has arrived. */
	models: ModelList;
	send: Dashboard["send"];
	/** End running session `instanceId`, as the header's End session and its shortcut do. */
	onEnd: (instanceId: string) => void;
	/** Header controls the page adds, such as closing a split pane. */
	actions?: ReactNode;
	/** Whether this is the focused pane, the one session shortcuts act on. */
	focused: boolean;
	/** The projects, as {@link workspaces} lists them, which the directory picker offers. */
	workspaces: Project[];
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
	if (working) {
		const target = agent ? "this subagent" : "the running turn";
		return followUps ? `Queue a follow-up… ${STEER_KEYS} steers ${target} now` : `Steer ${target}…`;
	}
	if (agent) return agent.status === "parked" ? "Message to revive this subagent…" : "Message this subagent…";
	return "Message this session…";
}

function LiveConversation({
	view,
	host,
	lastHost,
	initialDraft,
	fork,
	onFork,
	models,
	send,
	onEnd,
	actions,
	focused,
	workspaces,
}: ConversationProps) {
	const { scrollToEnd } = useMessageScroller();
	const composerRef = useRef<HTMLDivElement>(null);
	const { completions, dequeued } = useComposerData(view);
	const changed = useChangedFiles(view) ?? NO_FILES;
	const [draft, setDraft] = useState(initialDraft);
	const [modelsOpen, setModelsOpen] = useState<ModelMenuOpen | null>(null);
	const [directoriesOpen, setDirectoriesOpen] = useState(false);
	const attachments = useImageAttachments();

	const subject = subjectOf(view, host, lastHost);
	const { shown, agent, writable, attachable, working, requests, shell } = subject;
	const session = subject.kind === "session";
	const switchable = subject.kind === "session" ? subject.switchable : null;
	const thinking = shown?.thinkingLevel ?? null;
	const instanceId = view.instanceId;
	const editPrompt = useCallback((entryId: string, text: string) => send({ t: "edit-prompt", instanceId, entryId, text }), [instanceId, send]);
	const completion = useCompletion({
		composerRef,
		draft,
		setDraft,
		completions,
		onComplete: (reqId, text, cursor) => send({ t: "complete", reqId, scope: { kind: "live", view }, text, cursor }),
		composer: { sessionId: shown?.sessionId ?? null, changed },
	});

	const switchingModel = !!switchable && switchable.switching;
	const textarea = () => composerRef.current?.querySelector("textarea");
	const { queued, take } = useQueue({
		waiting: subject.queue,
		dequeued,
		dequeue: (reqId, messages) => send({ t: "dequeue", reqId, view, messages }),
		restore: text => {
			setDraft(current => (current ? `${text}\n${current}` : text));
			textarea()?.focus();
		},
	});
	// The focused pane's composer takes the keyboard once it can be typed in: when the view opens, and when it goes live, not when focus moves.
	const focusedNow = useRef(focused);
	focusedNow.current = focused;
	useEffect(() => {
		if (focusedNow.current && writable) textarea()?.focus();
	}, [writable]);
	// Queued messages come back into the composer instead of running after the interrupt.
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
		if (blockedShortcut(text, shell) === null) submit(text, working && subject.followUps ? "followUp" : "steer");
	};

	const directCommand = blockedShortcut(draft, shell);
	// What the finished turn suggests sending next, offered once nothing else waits on the user. Filtered to none the composer would hold back.
	const turnSuggestions = useNextSuggestions(view, working);
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
	// omp's `/move` refuses while a turn runs, a turn waiting on a question included.
	const movable = switchable?.status === "idle";

	const onComposerKey = useShortcuts({
		// The textarea's own keys, so they need no focused pane.
		steer: () => {
			const text = draft.trim();
			if (!writable || (!text && (!attachable || attachments.files.length === 0)) || directCommand) return false;
			submit(text, "steer");
		},
		// On the empty composer, the server stops the turn if omp still holds a steer, so omp runs it now.
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
					directory: () => {
						if (!movable) return false;
						setDirectoriesOpen(open => !open);
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
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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
					omp is running in {projectName(cwdDisplay) ?? cwdDisplay}. Send a message to start its first turn.
				</EmptyConversation>
			) : undefined,
		[session, writable, cwdDisplay],
	);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<ConversationHeader view={view} subject={subject} onEnd={onEnd} actions={actions} />
			<Transcript view={view} working={working} fork={fork} onFork={onFork} onEdit={switchable ? editPrompt : undefined} empty={empty} />
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
					ref={composerRef}
					value={draft}
					onValueChange={completion.onValueChange}
					textareaProps={{
						...completion.textareaProps,
						"aria-activedescendant": completion.textareaProps["aria-activedescendant"] ?? suggestions.activeId,
						onKeyDown,
						onBlur: suggestions.onBlur,
					}}
					onSend={sendText}
					leftSlot={
						<>
							<ModelSlot
								subject={subject}
								models={models}
								open={modelsOpen}
								onOpenChange={openModels}
								switching={switchingModel}
								onSetModel={(model, level) => send({ t: "set-model", instanceId: view.instanceId, model, thinking: level })}
								onSetThinking={setThinking}
								onSetFast={enabled => send({ t: "set-fast", instanceId: view.instanceId, enabled })}
							/>
							{switchable && shown && (
								<DirectoryPicker
									cwd={shown.cwdDisplay}
									workspaces={workspaces}
									disabled={!movable}
									tooltip={movable ? shown.cwdDisplay : `${shown.cwdDisplay} · Move the session once the turn ends`}
									shortcut="directory"
									open={directoriesOpen}
									onOpenChange={setDirectoriesOpen}
									onPick={dir => send({ t: "prompt", view, text: `/move ${dir}`, images: [], delivery: "steer" })}
								/>
							)}
						</>
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
					status={working ? "streaming" : "idle"}
					onStop={session ? interrupt : undefined}
					stopShortcut={shortcutLabels("interrupt")}
					sendLabel={working && subject.followUps ? "Queue a follow-up" : `${working ? "Steer" : "Send to"} ${agent ? "subagent" : "session"}`}
					beforeTextarea={<QueuedMessages entries={queued} onEdit={entry => take([entry], true)} onRemove={entry => take([entry], false)} />}
					afterActions={suggestions.list}
				/>
				{directCommand && <ComposerNote text={directCommand} />}
				{attachable && attachments.note && <ComposerNote text={attachments.note} />}
			</div>
		</div>
	);
}
