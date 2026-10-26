import { type ReactNode, useState } from "react";
import { type Question, type QuestionAnswer, QuestionCard } from "@/components/question-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AskReply, UserAnswer, UserRequest } from "../../src/shared/sessions";
import { errorText } from "../../src/json";
import { useShortcuts } from "../shortcuts";
import { toasts } from "./toaster";

const CONFIRM_ROWS = [{ title: "Yes" }, { title: "No" }];

/** The row after an `ask` question's own, which opens a text field; omp offers it on every question. */
const OTHER_ROW = { title: "Other", description: "Type your own answer" };

type AskRequest = Extract<UserRequest, { kind: "ask" }>;
type StepRequest = Exclude<UserRequest, { kind: "ask" }>;

/** omp's own labels can carry Nerd Font glyphs that the page's fonts lack; an answer keeps the label. */
const shownLabel = (label: string): string => label.replace(/\p{Co}/gu, "").trim();

/** The request as one question. Row indices are omp's option indices, so a pick maps back to omp's label. */
function questionOf(request: StepRequest): Question {
	switch (request.kind) {
		case "select":
			return {
				kind: "options",
				title: request.title,
				options: request.options.map(option => ({ title: shownLabel(option.label), description: option.description ?? undefined })),
				layout: request.options.some(option => (option.description?.length ?? 0) > 48) ? "stacked" : "inline",
			};
		case "confirm":
			return { kind: "options", title: request.title, description: request.message || undefined, options: CONFIRM_ROWS, layout: "inline" };
		case "text":
			return {
				kind: "text",
				title: request.title,
				multiline: request.multiline,
				placeholder: request.placeholder ?? undefined,
				submitLabel: "Send",
			};
		default: {
			const unhandled: never = request;
			return unhandled;
		}
	}
}

function answerOf(request: StepRequest, answer: QuestionAnswer): UserAnswer | null {
	switch (request.kind) {
		case "select": {
			const option = answer.kind === "option" ? request.options[answer.index] : undefined;
			return option ? { kind: "value", value: option.label } : null;
		}
		case "confirm":
			return answer.kind === "option" ? { kind: "confirm", confirmed: answer.index === 0 } : null;
		case "text":
			return answer.kind === "text" ? { kind: "value", value: answer.text } : null;
		default: {
			const unhandled: never = request;
			return unhandled;
		}
	}
}

interface UserRequestCardProps {
	request: UserRequest;
	/** How many more questions wait behind this one. */
	queued: number;
	/** Sends the answer; a rejection lets the card take another, and shows why. */
	onAnswer: (answer: UserAnswer) => Promise<void>;
	/** Whether 1 to 9 pick this card's options: only in the focused pane, so a key never answers another pane's question. */
	shortcuts: boolean;
}

/** Sends one answer at a time: the roster drops an answered request a moment later, and until then the card ignores more input. */
function useReply(onAnswer: (answer: UserAnswer) => Promise<void>): { sent: boolean; reply: (answer: UserAnswer) => void } {
	const [sent, setSent] = useState(false);
	const reply = (answer: UserAnswer): void => {
		if (sent) return;
		setSent(true);
		onAnswer(answer).catch((error: unknown) => {
			setSent(false);
			toasts.add({ title: "Could not answer", description: errorText(error) });
		});
	};
	return { sent, reply };
}

/** The card's top line: what the question is, when omp stops waiting, and how many more wait. */
function statusOf(request: UserRequest, queued: number, prefix: string[] = []): string {
	return [
		...prefix,
		request.deadline === null ? "Waiting for your answer" : `Answer by ${new Date(request.deadline).toLocaleTimeString()}`,
		queued > 0 && `${queued} more waiting`,
	]
		.filter(Boolean)
		.join(" · ");
}

function CardHeader({ status, sent, onDismiss }: { status: string; sent: boolean; onDismiss: () => void }) {
	return (
		<>
			<span role="status">{status}</span>
			<Button variant="ghost" size="compact" className="-my-1 ml-auto" disabled={sent} onClick={onDismiss}>
				Dismiss
			</Button>
		</>
	);
}

/**
 * A question the session waits on, answered here instead of in the omp terminal. Keyed by request id: a terminal
 * session sends each step of an `ask` as a new request, and a multi-select pick comes back as a fresh copy with the row
 * checked; a dashboard session sends the whole `ask` as one request.
 */
export function UserRequestCard(props: UserRequestCardProps) {
	const { request } = props;
	return request.kind === "ask" ? <AskCard {...props} request={request} /> : <StepCard {...props} request={request} />;
}

function StepCard({ request, queued, onAnswer, shortcuts }: UserRequestCardProps & { request: StepRequest }) {
	const { sent, reply } = useReply(onAnswer);
	const [picked, setPicked] = useState<number | null>(null);
	const question = questionOf(request);
	const choose = (choice: QuestionAnswer): void => {
		if (choice.kind === "option") setPicked(choice.index);
		const answer = answerOf(request, choice);
		if (answer) reply(answer);
	};
	useShortcuts(
		shortcuts
			? {
					answer: key => {
						if (question.kind !== "options" || key >= question.options.length) return false;
						choose({ kind: "option", index: key });
					},
				}
			: {},
	);

	return (
		<QuestionCard
			question={question}
			// A select's checked rows come from omp; any other request shows the row picked here.
			checked={request.kind === "select" ? request.checked : picked === null ? [] : [picked]}
			defaultText={request.kind === "text" ? request.prefill : undefined}
			onAnswer={choose}
			onKeyDown={event => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				reply({ kind: "cancel" });
			}}
			header={<CardHeader status={statusOf(request, queued)} sent={sent} onDismiss={() => reply({ kind: "cancel" })} />}
			aria-busy={sent || undefined}
			className={cn("mb-3 max-w-none", sent && "pointer-events-none opacity-60")}
		/>
	);
}

/**
 * A whole `ask` call, one question at a time. A single-select pick moves to the next question; a multi-select question
 * toggles its rows and moves on with its button. The last question sends every answer at once, as omp takes them.
 */
function AskCard({ request, queued, onAnswer, shortcuts }: UserRequestCardProps & { request: AskRequest }) {
	const { sent, reply } = useReply(onAnswer);
	const [step, setStep] = useState(0);
	const [replies, setReplies] = useState<AskReply[]>(() => request.questions.map(question => ({ id: question.id, selected: [], custom: null })));
	const [typing, setTyping] = useState(false);
	const question = request.questions[step]!;
	const current = replies[step]!;
	const last = step === request.questions.length - 1;

	const advance = (next: AskReply[]): void => {
		setReplies(next);
		setTyping(false);
		if (last) reply({ kind: "ask", answers: next });
		else setStep(step + 1);
	};
	const update = (changed: AskReply): AskReply[] => replies.map((existing, index) => (index === step ? changed : existing));

	const rows = question.options.map((option, index) => ({
		title: index === question.recommended ? `${shownLabel(option.label)} (Recommended)` : shownLabel(option.label),
		description: option.description ?? undefined,
	}));
	const shown: Question = typing
		? { kind: "text", title: question.question, multiline: false, placeholder: "Type your answer…", submitLabel: last && !question.multi ? "Send" : "Next" }
		: {
				kind: "options",
				title: question.question,
				options: [...rows, OTHER_ROW],
				layout: question.options.some(option => (option.description?.length ?? 0) > 48) ? "stacked" : "inline",
				multi: question.multi,
			};
	const checked = [
		...current.selected.map(label => question.options.findIndex(option => option.label === label)),
		...(current.custom === null ? [] : [question.options.length]),
	];

	const choose = (choice: QuestionAnswer): void => {
		if (choice.kind === "text") {
			// A multi-select question keeps its picks beside the typed text and goes back to its rows.
			if (question.multi) {
				setReplies(update({ ...current, custom: choice.text }));
				setTyping(false);
			} else advance(update({ ...current, selected: [], custom: choice.text }));
			return;
		}
		if (choice.index === question.options.length) {
			if (question.multi && current.custom !== null) setReplies(update({ ...current, custom: null }));
			else setTyping(true);
			return;
		}
		const label = question.options[choice.index]!.label;
		if (!question.multi) {
			advance(update({ id: question.id, selected: [label], custom: null }));
			return;
		}
		const selected = current.selected.includes(label) ? current.selected.filter(existing => existing !== label) : [...current.selected, label];
		setReplies(update({ ...current, selected }));
	};
	useShortcuts(
		shortcuts && !typing
			? {
					answer: key => {
						if (key > question.options.length) return false;
						choose({ kind: "option", index: key });
					},
				}
			: {},
	);

	const back = step > 0 && (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => {
				setTyping(false);
				setStep(step - 1);
			}}
		>
			Back
		</Button>
	);
	let footer: ReactNode = null;
	if (!typing && (question.multi || back)) {
		footer = (
			<div className="flex items-center justify-end gap-2 -mx-2 sm:-mx-3">
				{back}
				{question.multi && (
					<Button size="sm" onClick={() => advance(replies)}>
						{last ? "Send" : "Next"}
					</Button>
				)}
			</div>
		);
	}

	const position = request.questions.length > 1 ? `Question ${step + 1} of ${request.questions.length}` : "";
	return (
		<QuestionCard
			// Each question and its text field start afresh, with the text typed before.
			key={`${step}:${typing}`}
			question={shown}
			checked={checked}
			defaultText={current.custom ?? ""}
			footer={footer}
			onAnswer={choose}
			onKeyDown={event => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				// Escape in the text field goes back to the rows; on the rows it dismisses the whole `ask`.
				if (typing) setTyping(false);
				else reply({ kind: "cancel" });
			}}
			header={
				<CardHeader status={statusOf(request, queued, [question.header ?? "", position])} sent={sent} onDismiss={() => reply({ kind: "cancel" })} />
			}
			aria-busy={sent || undefined}
			className={cn("mb-3 max-w-none", sent && "pointer-events-none opacity-60")}
		/>
	);
}
