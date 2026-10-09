import { useState } from "react";
import { type Question, type QuestionAnswer, QuestionCard } from "@/components/question-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserAnswer, UserRequest } from "../../src/shared/sessions";

const CONFIRM_ROWS = [{ title: "Yes" }, { title: "No" }];

/** The request as one question. Row indices are omp's option indices, so a pick maps back to omp's label. */
function questionOf(request: UserRequest): Question {
	switch (request.kind) {
		case "select":
			return {
				kind: "options",
				title: request.title,
				options: request.options.map(option => ({
					// omp's own labels can carry Nerd Font glyphs that the page's fonts lack; the answer keeps the label.
					title: option.label.replace(/\p{Co}/gu, "").trim(),
					description: option.description ?? undefined,
				})),
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

function answerOf(request: UserRequest, answer: QuestionAnswer): UserAnswer | null {
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
		<QuestionCard
			question={question}
			checked={request.kind === "select" ? request.checked : undefined}
			defaultText={request.kind === "text" ? request.prefill : undefined}
			onAnswer={picked => {
				const answer = answerOf(request, picked);
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
