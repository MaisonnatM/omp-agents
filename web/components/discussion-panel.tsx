/** `DiscussionPanel`: the **Ask about this** discussion, beside the page and not over it, until you close it. */
import { Check, Send, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { DISCUSSION_SYSTEM_PROMPT, discussionPrompt, MAX_DISCUSSION_QUESTION, sessionMessage } from "../../src/shared/discussions";
import { Button } from "@/components/ui/button";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { type AskedTurn, askDiscussion, closeDiscussion, type Discussion, discussionRequest, stopDiscussion, useDiscussion } from "../discussions";
import { useAction } from "../use-action";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { MessageMarkdown } from "./message-markdown";

/** Where focus was when **Ask about this** opened the panel, where closing it puts focus back. */
let returnTo: HTMLElement | null = null;

/** Notes where focus is before the panel takes it. */
export function rememberFocus(): void {
	returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
}

/** The open discussion, if any, at the page's bottom right. */
export function DiscussionPanel() {
	const discussion = useDiscussion();
	// Each **Ask about this** starts a new panel, with an empty question and focus in it.
	return discussion && <Panel key={discussion.opened} discussion={discussion} />;
}

function Panel({ discussion }: { discussion: Discussion }) {
	const { send } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [question, setQuestion] = useState("");
	const fieldRef = useRef<HTMLTextAreaElement>(null);
	const titleId = useId();
	const fieldId = useId();
	const streaming = discussion.turns.some(turn => turn.status === "streaming");
	const last = discussion.turns.at(-1);

	useEffect(() => fieldRef.current?.focus(), []);

	const close = (): void => {
		closeDiscussion(send);
		if (returnTo?.isConnected) returnTo.focus();
		returnTo = null;
	};
	const ask = (): void => {
		if (!connected || streaming || question.trim() === "") return;
		askDiscussion(question, send);
		setQuestion("");
	};
	const onPanelKey = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
		event.preventDefault();
		close();
	};
	const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		ask();
	};

	return (
		<section
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			onKeyDown={onPanelKey}
			// Top right, so the toasts that stack at the bottom right never cover the question field.
			className="fixed top-14 right-4 z-40 flex max-h-[min(44rem,calc(100svh-10rem))] w-[28rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-background shadow-xl"
		>
			<header className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
				<h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium">
					Ask about this
				</h2>
				<Button variant="ghost" size="icon-compact" aria-label="Close the discussion" onClick={close}>
					<X aria-hidden />
				</Button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
				<figure className="flex flex-col gap-1">
					<figcaption className="text-xs text-muted-foreground">From {discussion.source}</figcaption>
					<blockquote className="max-h-40 overflow-y-auto rounded-md border-l-2 border-border bg-muted/50 px-3 py-2 font-mono text-xs whitespace-pre-wrap">{discussion.quote}</blockquote>
				</figure>
				<details className="text-xs text-muted-foreground">
					<summary className="cursor-pointer">The model sees this passage, its source, and this discussion, with no tools</summary>
					<pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/50 p-2 font-mono whitespace-pre-wrap">
						{`${DISCUSSION_SYSTEM_PROMPT}\n\n${discussionPrompt(discussionRequest(discussion, question || "(your question)"))}`}
					</pre>
				</details>
				{discussion.turns.map(turn => (
					<Turn key={turn.id} turn={turn} quote={discussion.quote} sendToSession={discussion.sendToSession} />
				))}
			</div>
			<p role="status" className="sr-only">
				{last?.status === "streaming" ? "Answering" : last?.status === "done" ? "Answered" : ""}
			</p>
			<div className="flex items-end gap-2 border-t border-border p-2">
				<label htmlFor={fieldId} className="sr-only">
					{discussion.turns.length === 0 ? "Question about the passage" : "Follow-up question"}
				</label>
				<textarea
					id={fieldId}
					ref={fieldRef}
					value={question}
					rows={2}
					maxLength={MAX_DISCUSSION_QUESTION}
					placeholder={discussion.turns.length === 0 ? "What do you want to know about it?" : "Ask a follow-up…"}
					onChange={event => setQuestion(event.target.value)}
					onKeyDown={onFieldKey}
					className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm [field-sizing:content] outline-none"
				/>
				{streaming ? (
					<Button variant="secondary" size="compact" onClick={() => stopDiscussion(send)}>
						Stop
					</Button>
				) : (
					<Button size="compact" disabled={!connected || question.trim() === ""} onClick={ask}>
						Ask
					</Button>
				)}
			</div>
		</section>
	);
}

function Turn({ turn, quote, sendToSession }: { turn: AskedTurn; quote: string; sendToSession: Discussion["sendToSession"] }) {
	const [sent, setSent] = useState(false);
	const sending = useAction(async () => {
		if (!sendToSession) return;
		await sendToSession(sessionMessage(quote, turn.answer));
		setSent(true);
	}, "Could not send to the session");
	return (
		<article className="flex flex-col gap-1.5 border-t border-border pt-3" aria-busy={turn.status === "streaming" || undefined}>
			<p className="text-sm font-medium whitespace-pre-wrap">{turn.question}</p>
			{turn.answer ? (
				<div className="text-sm">
					<MessageMarkdown text={turn.answer} />
				</div>
			) : (
				turn.status === "streaming" && <ThinkingIndicator className="self-start" />
			)}
			{turn.status === "failed" && <p className="text-xs text-destructive">Could not answer: {turn.error}</p>}
			{turn.status === "stopped" && <p className="text-xs text-muted-foreground">Stopped</p>}
			<div className="flex items-center gap-2">
				{turn.model && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{turn.model}</span>}
				{sendToSession && turn.status === "done" && turn.answer.trim() !== "" && (
					// aria-disabled, not disabled, so focus stays on the button and Esc still reaches the panel after a send.
					<Button
						variant="tertiary"
						size="compact"
						leadingIcon={sent ? Check : Send}
						aria-disabled={sending.pending || sent || undefined}
						aria-busy={sending.pending || undefined}
						onClick={() => {
							if (!sent) sending.run();
						}}
					>
						{sent ? "Sent to session" : "Send to session"}
					</Button>
				)}
			</div>
		</article>
	);
}
