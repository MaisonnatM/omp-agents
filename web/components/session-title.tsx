import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useAction } from "../use-action";
import { useDashboardActions } from "./dashboard-context";

interface SessionTitleProps {
	sessionId: string;
	/** The title the header shows, which the field starts from. */
	title: string;
}

/** Where the title stands: shown, with the focus back on it after Enter or Escape closed the field, or typed into. */
type Phase = { kind: "shown"; refocus: boolean } | { kind: "editing" };

/**
 * A session's title in its pane header, which a click turns into a field that renames the session: Enter or leaving the
 * field saves, Escape cancels. A title left empty or unchanged saves nothing.
 */
export function SessionTitle({ sessionId, title }: SessionTitleProps) {
	const [phase, setPhase] = useState<Phase>({ kind: "shown", refocus: false });
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (phase.kind === "shown" && phase.refocus) button.current?.focus();
	}, [phase]);
	if (phase.kind === "editing") return <TitleField sessionId={sessionId} title={title} onClose={refocus => setPhase({ kind: "shown", refocus })} />;
	return (
		<Tooltip content="Rename" side="bottom">
			<button
				ref={button}
				type="button"
				className="block max-w-full cursor-text truncate rounded-sm text-left outline-none hover:underline hover:decoration-muted-foreground hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				onClick={() => setPhase({ kind: "editing" })}
			>
				{title}
			</button>
		</Tooltip>
	);
}

/** The field one rename is typed into, mounted for that rename alone, so what it settled never carries into the next. */
function TitleField({ sessionId, title, onClose }: SessionTitleProps & { onClose: (refocus: boolean) => void }) {
	const { request } = useDashboardActions();
	const [draft, setDraft] = useState(title);
	// Set as the field closes, before React removes it, so the blur its removal may fire saves nothing.
	const closing = useRef(false);
	const close = (refocus: boolean): void => {
		closing.current = true;
		onClose(refocus);
	};
	const save = useAction(async (value: string, refocus: boolean) => {
		const next = value.trim();
		if (next && next !== title) await request({ t: "rename-session", sessionId, title: next });
		close(refocus);
	}, "Could not rename the session");
	return (
		<form
			className="flex min-w-0"
			onSubmit={event => {
				event.preventDefault();
				save.run(draft, true);
			}}
		>
			<input
				autoFocus
				aria-label="Session title"
				value={draft}
				readOnly={save.pending}
				onFocus={event => event.currentTarget.select()}
				onChange={event => setDraft(event.target.value)}
				onBlur={() => {
					if (!closing.current) save.run(draft, false);
				}}
				onKeyDown={event => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					if (!save.pending) close(true);
				}}
				className="h-7 w-80 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			/>
		</form>
	);
}
