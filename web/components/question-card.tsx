/** `QuestionCard`, a card that asks one question: rows to pick from or a text field to answer. */
import { motion } from "framer-motion";
import { type HTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { IS_MAC, modHeld } from "../shortcuts";
import { type OptionLayout, type QuestionOption, QuestionOptions } from "./question-options";

/** What a card asks: rows to pick one or several of, or a free-text answer. */
export type Question = { title: string; description?: string } & (
	| { kind: "options"; options: QuestionOption[]; layout: OptionLayout; multi?: boolean }
	| { kind: "text"; multiline: boolean; placeholder?: string; submitLabel: string }
);

/** A picked row's index, or the typed text, trimmed. */
export type QuestionAnswer = { kind: "option"; index: number } | { kind: "text"; text: string };

interface QuestionCardProps extends HTMLAttributes<HTMLDivElement> {
	question: Question;
	/** The rows shown checked. */
	checked: readonly number[];
	/** The text field's starting text. */
	defaultText?: string;
	/** The line above the title. */
	header: ReactNode;
	/** The row under an options question, such as the button that sends a multi-select's picks. */
	footer?: ReactNode;
	onAnswer: (answer: QuestionAnswer) => void;
}

/** The keys that send a text answer: ⌘↵ on macOS, ⌃↵ elsewhere. */
const SUBMIT_CHORD = `${IS_MAC ? "⌘" : "⌃"}↵`;

/**
 * One question, asked in Fluid's look. Option rows answer on a click, or on Enter or Space; number keys are the
 * owner's to bind. A text question focuses its field on mount and sends with the submit button, with ⌘↵ or ⌃↵, or with
 * Enter when it is single-line.
 */
export function QuestionCard({ question, checked, defaultText = "", header, footer, onAnswer, className, onKeyDown, ...rest }: QuestionCardProps) {
	const shape = useShape();
	const size = useSize();
	const compact = size.variant === "compact";
	const titleId = useId();
	const [text, setText] = useState(defaultText);

	const submit = (): void => {
		const trimmed = text.trim();
		if (!trimmed) return;
		setText(trimmed);
		onAnswer({ kind: "text", text: trimmed });
	};

	// The card's height springs to its content's, so the border follows a text field that grows a line.
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number | "auto">("auto");
	useEffect(() => {
		const content = contentRef.current;
		if (!content) return;
		const update = (): void => setContentHeight(content.offsetHeight);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(content);
		return () => observer.disconnect();
	}, []);

	const padX = compact ? "px-3.5 sm:px-4" : "px-4 sm:px-5";

	return (
		<div
			className={cn("relative w-full max-w-[520px] overflow-hidden bg-card border border-border", shape.container, className)}
			{...rest}
			onKeyDown={event => {
				onKeyDown?.(event);
				if (question.kind !== "text" || event.key !== "Enter" || !modHeld(event)) return;
				// Keeps the focused button from also activating.
				event.preventDefault();
				submit();
			}}
		>
			<div
				className={cn(
					"flex items-center text-muted-foreground",
					compact ? "px-3.5 sm:px-4 pt-2.5 sm:pt-3 pb-1.5 text-[11px]" : "px-4 sm:px-5 pt-3.5 sm:pt-4 pb-2 text-[12px]",
				)}
			>
				{header}
			</div>
			<motion.div animate={{ height: contentHeight }} initial={false} transition={spring.slow} className="overflow-hidden">
				<div ref={contentRef} className={cn(padX, question.kind === "text" ? "pb-1" : compact ? "pb-2 sm:pb-2.5" : "pb-2.5 sm:pb-3")}>
					<div className="flex flex-col gap-2">
						<h3 id={titleId} className="text-[16px] text-foreground leading-snug" style={{ fontVariationSettings: fontWeights.semibold }}>
							{question.title}
						</h3>
						{question.description && (
							<p className="text-[13px] text-muted-foreground leading-snug whitespace-pre-wrap">{question.description}</p>
						)}
						{question.kind === "options" ? (
							<QuestionOptions
								options={question.options}
								layout={question.layout}
								selected={checked}
								multi={question.multi}
								labelledBy={titleId}
								onPick={index => onAnswer({ kind: "option", index })}
							/>
						) : (
							<TextAnswer
								value={text}
								multiline={question.multiline}
								placeholder={question.placeholder ?? "Type your answer…"}
								labelledBy={titleId}
								onChange={setText}
								onSubmit={submit}
							/>
						)}
					</div>
				</div>
			</motion.div>
			{question.kind === "options" && footer && <div className={cn("pt-1", padX, compact ? "pb-1.5" : "pb-2")}>{footer}</div>}
			{question.kind === "text" && (
				<div className={cn("pt-1", padX, compact ? "pb-1.5" : "pb-2")}>
					<div className="flex items-center justify-end -mx-2 sm:-mx-3">
						<Button size="sm" onClick={submit} disabled={text.trim().length === 0} className="pr-3 sm:pr-2">
							<span className="inline-flex items-center gap-1.5">
								{question.submitLabel}
								<kbd
									aria-hidden
									className={cn(
										"hidden sm:inline-flex items-center justify-center gap-0.5 px-1 min-w-[18px] h-[18px] text-[11px] leading-none font-sans tracking-wide bg-current/15",
										shape.bg,
									)}
								>
									{SUBMIT_CHORD}
								</kbd>
							</span>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

interface TextAnswerProps {
	value: string;
	multiline: boolean;
	placeholder: string;
	labelledBy: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
}

/**
 * The free-text answer: a field that takes focus on mount and grows with its text. A multi-line field rests a few lines
 * tall and takes Enter as a newline; a single-line one rests one row tall and sends on Enter. Shift+Enter is always a
 * newline.
 */
function TextAnswer({ value, multiline, placeholder, labelledBy, onChange, onSubmit }: TextAnswerProps) {
	const shape = useShape();
	const size = useSize();
	const compact = size.variant === "compact";
	const fieldRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		fieldRef.current?.focus({ preventScroll: true });
	}, []);

	// A textarea does not fit its text: collapse it so it can shrink, then grow it to its content.
	useEffect(() => {
		const field = fieldRef.current;
		if (!field) return;
		field.style.height = "0px";
		field.style.height = `${field.scrollHeight}px`;
	}, [value]);

	return (
		// The resting height lives on the box, since the field's own height follows its text; a click anywhere in it focuses the field.
		<div
			onClick={() => fieldRef.current?.focus()}
			className={cn(
				"relative mt-1 cursor-text transition-colors",
				compact ? "-mx-2.5 py-2" : "-mx-3 py-2.5",
				size.px,
				multiline ? "min-h-[76px]" : compact ? "min-h-8" : "min-h-10",
				shape.bg,
				value.length > 0 ? "bg-active" : "hover:bg-hover focus-within:bg-card focus-within:ring-1 focus-within:ring-inset focus-within:ring-border",
			)}
		>
			<textarea
				ref={fieldRef}
				rows={1}
				value={value}
				placeholder={placeholder}
				aria-labelledby={labelledBy}
				onChange={event => onChange(event.target.value)}
				onKeyDown={event => {
					// ⌘↵ and ⌃↵ reach the card, which sends from either kind of field.
					if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || multiline) return;
					event.preventDefault();
					onSubmit();
				}}
				className={cn(
					"block w-full bg-transparent border-0 p-0 m-0 outline-none resize-none overflow-hidden leading-snug text-foreground placeholder:text-muted-foreground",
					size.text,
				)}
				style={{ fontVariationSettings: fontWeights.medium }}
			/>
		</div>
	);
}
