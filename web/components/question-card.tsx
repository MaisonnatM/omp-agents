import { motion } from "framer-motion";
import { type HTMLAttributes, type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { IS_MAC } from "../shortcuts";
import { type OptionLayout, type QuestionOption, QuestionOptions } from "./question-options";

/** What a card asks: rows to pick one of, or a free-text answer. */
export type Question = { title: string; description?: string } & (
	| { kind: "options"; options: QuestionOption[]; layout: OptionLayout }
	| { kind: "text"; multiline: boolean; placeholder?: string; submitLabel: string }
);

/** A picked row's index, or the typed text, trimmed. */
export type QuestionAnswer = { kind: "option"; index: number } | { kind: "text"; text: string };

interface QuestionCardProps extends HTMLAttributes<HTMLDivElement> {
	question: Question;
	/** The rows shown checked. Omitted, the card checks the row it picks. */
	checked?: readonly number[];
	/** The text field's starting text. */
	defaultText?: string;
	/** The line above the title. */
	header: ReactNode;
	onAnswer: (answer: QuestionAnswer) => void;
}

/**
 * The cards on the page, oldest first. Only one card answers a digit: the one holding focus, else the latest mounted,
 * among those inside the focused element when it holds some.
 */
const mountedCards: HTMLElement[] = [];

function answersDigit(card: HTMLElement, target: HTMLElement): boolean {
	if (card.contains(target)) return true;
	if (mountedCards.some(other => other !== card && other.contains(target))) return false;
	const wrapped = mountedCards.filter(other => target.contains(other));
	const pool = wrapped.length > 0 ? wrapped : mountedCards;
	return pool[pool.length - 1] === card;
}

/** The keys that send a text answer: ⌘↵ on macOS, ⌃↵ elsewhere. */
const SUBMIT_CHORD = `${IS_MAC ? "⌘" : "⌃"}↵`;

/**
 * One question, asked in Fluid's look. Option rows answer on a click, on Enter or Space, or on their number key, which
 * works from anywhere on the page outside a text field. A text question focuses its field on mount and sends with the
 * submit button, with ⌘↵ or ⌃↵, or with Enter when it is single-line.
 */
export function QuestionCard({ question, checked, defaultText = "", header, onAnswer, className, onKeyDown, ...rest }: QuestionCardProps) {
	const shape = useShape();
	const size = useSize();
	const compact = size.variant === "compact";
	const titleId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const [picked, setPicked] = useState<number | null>(null);
	const [text, setText] = useState(defaultText);
	const optionCount = question.kind === "options" ? question.options.length : 0;

	const pick = (index: number): void => {
		if (!checked) setPicked(index);
		onAnswer({ kind: "option", index });
	};

	const submit = (): void => {
		const trimmed = text.trim();
		if (!trimmed) return;
		setText(trimmed);
		onAnswer({ kind: "text", text: trimmed });
	};

	useEffect(() => {
		const card = rootRef.current;
		if (!card) return;
		mountedCards.push(card);
		return () => {
			const at = mountedCards.indexOf(card);
			if (at !== -1) mountedCards.splice(at, 1);
		};
	}, []);

	const onDigit = useEffectEvent((event: KeyboardEvent): void => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		const card = rootRef.current;
		if (!target || !card) return;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
		if (!answersDigit(card, target)) return;
		if (event.key < "1" || event.key > "9") return;
		const index = Number(event.key) - 1;
		if (index >= optionCount) return;
		event.preventDefault();
		pick(index);
	});
	useEffect(() => {
		if (optionCount === 0) return;
		const listener = (event: KeyboardEvent): void => onDigit(event);
		document.addEventListener("keydown", listener);
		return () => document.removeEventListener("keydown", listener);
	}, [optionCount]);

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
			ref={rootRef}
			className={cn("relative w-full max-w-[520px] overflow-hidden bg-card border border-border", shape.container, className)}
			{...rest}
			onKeyDown={event => {
				onKeyDown?.(event);
				if (question.kind !== "text" || event.key !== "Enter" || !(IS_MAC ? event.metaKey : event.ctrlKey)) return;
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
								selected={checked ?? (picked === null ? [] : [picked])}
								labelledBy={titleId}
								onPick={pick}
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
