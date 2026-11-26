/** `StepInput`: the input a plan step's text, or a new sub-step, is typed into, and the keys it acts on. */
import { type KeyboardEvent, useRef, useState } from "react";

/** The keys a step's input acts on, beyond typing. */
export type StepKey = "enter" | "escape";

function stepKey(event: KeyboardEvent<HTMLInputElement>): StepKey | null {
	if (event.nativeEvent.isComposing || event.altKey || event.metaKey || event.ctrlKey) return null;
	if (event.key === "Enter") return "enter";
	return event.key === "Escape" ? "escape" : null;
}

interface StepInputProps {
	initial: string;
	label: string;
	/** Acts on `key`; whether the input goes away, so its blur must not save again. */
	onKey: (key: StepKey, text: string) => boolean;
	/** Focus left the input with `text` in it. */
	onLeave: (text: string) => void;
}

/** The input a step's text, or a sub-step not added yet, is typed into. */
export function StepInput({ initial, label, onKey, onLeave }: StepInputProps) {
	const [text, setText] = useState(initial);
	const settled = useRef(false);
	return (
		<input
			autoFocus
			aria-label={label}
			value={text}
			onChange={event => setText(event.target.value)}
			onKeyDown={event => {
				const key = stepKey(event);
				if (!key) return;
				event.preventDefault();
				settled.current = onKey(key, text);
			}}
			onBlur={() => {
				if (!settled.current) onLeave(text);
			}}
			className="-mx-1 min-w-0 flex-1 rounded-sm bg-transparent px-1 outline-none ring-1 ring-ring/40"
		/>
	);
}
