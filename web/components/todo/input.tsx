import { type KeyboardEvent, useRef, useState } from "react";

/** The keys a todo's input acts on, beyond typing. */
export type TodoKey = "enter" | "start" | "escape" | "indent" | "outdent" | "erase";

function todoKey(event: KeyboardEvent<HTMLInputElement>): TodoKey | null {
	if (event.nativeEvent.isComposing || event.altKey) return null;
	if (event.metaKey || event.ctrlKey) return event.key === "Enter" ? "start" : null;
	switch (event.key) {
		case "Enter":
			return "enter";
		case "Escape":
			return "escape";
		case "Tab":
			return event.shiftKey ? "outdent" : "indent";
		case "Backspace":
			return event.currentTarget.value === "" ? "erase" : null;
		default:
			return null;
	}
}

interface TodoInputProps {
	initial: string;
	label: string;
	/** Acts on `key`; whether the input goes away, so its blur must not save again. */
	onKey: (key: TodoKey, text: string) => boolean;
	/** Focus left the input with `text` in it. */
	onLeave: (text: string) => void;
}

/** The input a todo's title, or a todo not added yet, is typed into. */
export function TodoInput({ initial, label, onKey, onLeave }: TodoInputProps) {
	const [text, setText] = useState(initial);
	const settled = useRef(false);
	return (
		<input
			autoFocus
			aria-label={label}
			value={text}
			onChange={event => setText(event.target.value)}
			onKeyDown={event => {
				const key = todoKey(event);
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
