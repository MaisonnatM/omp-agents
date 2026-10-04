import { useState } from "react";
import { type AskUserAnswer, type AskUserQuestion, AskUserQuestions } from "@/components/ui/ask-user-questions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserAnswer, UserRequest } from "../../src/shared";

const CONFIRM_ROWS = [
	{ id: "yes", title: "Yes" },
	{ id: "no", title: "No" },
];

/** The request as one Fluid question. Row ids are row indices, so a pick maps back to omp's label. */
function questionOf(request: UserRequest): AskUserQuestion {
	switch (request.kind) {
		case "select":
			return {
				id: request.id,
				title: request.title,
				options: request.options.map((option, index) => ({
					id: String(index),
					// omp's own labels can carry Nerd Font glyphs that the page's fonts lack; the answer keeps the label.
					title: option.label.replace(/\p{Co}/gu, "").trim(),
					description: option.description ?? undefined,
				})),
				layout: request.options.some(option => (option.description?.length ?? 0) > 48) ? "stacked" : "inline",
			};
		case "confirm":
			return { id: request.id, title: request.title, description: request.message || undefined, options: CONFIRM_ROWS };
		case "text":
			return {
				id: request.id,
				title: request.title,
				freeText: true,
				freeTextMultiline: request.multiline,
				freeTextPlaceholder: request.placeholder ?? undefined,
				nextLabel: "Send",
			};
		default: {
			const unhandled: never = request;
			return unhandled;
		}
	}
}

function answerOf(request: UserRequest, answer: AskUserAnswer | undefined): UserAnswer | null {
	const [picked] = answer?.selectedIds ?? [];
	switch (request.kind) {
		case "select": {
			const option = picked === undefined ? undefined : request.options[Number(picked)];
			return option ? { kind: "value", value: option.label } : null;
		}
		case "confirm":
			return picked === undefined ? null : { kind: "confirm", confirmed: picked === "yes" };
		case "text":
			return answer?.otherText === undefined ? null : { kind: "value", value: answer.otherText };
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
	onAnswer: (answer: UserAnswer) => void;
}

/**
 * A question the session waits on, answered here instead of in the omp terminal. Keyed by request id:
 * omp sends each step of an `ask` as a new request, and a multi-select pick comes back as a fresh copy
 * with the row checked.
 */
export function UserRequestCard({ request, queued, onAnswer }: UserRequestCardProps) {
	// The roster drops an answered request a moment later; until then the card ignores more input.
	const [sent, setSent] = useState(false);
	const question = questionOf(request);
	const reply = (answer: UserAnswer): void => {
		if (sent) return;
		setSent(true);
		onAnswer(answer);
	};

	const status = [
		request.deadline === null ? "Waiting for your answer" : `Answer by ${new Date(request.deadline).toLocaleTimeString()}`,
		queued > 0 && `${queued} more waiting`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<AskUserQuestions
			questions={[question]}
			answers={request.kind === "select" ? { [request.id]: { questionId: request.id, selectedIds: request.checked.map(String) } } : undefined}
			defaultAnswers={
				request.kind === "text" ? { [request.id]: { questionId: request.id, selectedIds: [], otherText: request.prefill } } : undefined
			}
			onComplete={answers => {
				const answer = answerOf(request, answers[request.id]);
				if (answer) reply(answer);
			}}
			onKeyDown={event => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				reply({ kind: "cancel" });
			}}
			header={
				<>
					<span role="status">{status}</span>
					<Button variant="ghost" size="compact" className="-my-1 ml-auto" disabled={sent} onClick={() => reply({ kind: "cancel" })}>
						Dismiss
					</Button>
				</>
			}
			aria-busy={sent || undefined}
			className={cn("mb-3 max-w-none", sent && "pointer-events-none opacity-60")}
		/>
	);
}
