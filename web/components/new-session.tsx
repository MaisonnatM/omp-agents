import { useState } from "react";
import { InputMessage } from "@/components/ui/input-message";
import { projectName } from "../labels";
import type { Completions } from "../pane-store";
import type { StartOf } from "../starts";
import { useCompletion } from "./completion-popup";
import { DirectCommandNote, directCommandOf, Header } from "./conversation";

interface NewSessionProps {
	/** Where omp starts, as typed or displayed (`~/code/webapp`). */
	cwd: string;
	launch: StartOf<"new"> | null;
	connected: boolean;
	/** The server's last answer to this draft's `complete`. */
	completions: Completions | null;
	/** Ask for `/` and `@` suggestions, resolved as a session started in `cwd` would resolve them. */
	onComplete: (reqId: number, text: string, cursor: number) => void;
	/** Start omp in `cwd` with `prompt` as its first message. */
	onStart: (prompt: string) => void;
}

/**
 * A session not started yet, with the same composer a live session has. omp starts in `cwd` only when the first message
 * is sent, so leaving the draft leaves nothing running. The message stays in the composer until the session opens.
 */
export function NewSession({ cwd, launch, connected, completions, onComplete, onStart }: NewSessionProps) {
	const [draft, setDraft] = useState("");
	const completion = useCompletion({ draft, setDraft, completions, onComplete });
	const starting = launch?.phase === "starting";
	const directCommand = directCommandOf(draft);
	const name = projectName(cwd) ?? cwd;
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<Header title="New session" meta={<span title={cwd}>{cwd}</span>} status={starting ? "Starting omp…" : undefined} />
			{launch?.phase === "failed" && (
				<p role="alert" className="border-b border-border px-6 py-2 text-xs text-red-600 dark:text-red-400">
					{launch.error}
				</p>
			)}
			<p className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">omp starts in {name} when you send the first message.</p>
			<div className="relative mx-auto w-full max-w-3xl px-6 pb-5">
				{completion.popup}
				<InputMessage
					ref={completion.composerRef}
					value={draft}
					onValueChange={completion.onValueChange}
					onSend={text => {
						if (directCommand) return;
						completion.close();
						onStart(text);
					}}
					placeholder="Message this session…"
					disabled={starting || !connected}
					sendLabel="Start session"
					textareaProps={{ ...completion.textareaProps, autoFocus: true }}
				/>
				{directCommand && <DirectCommandNote kind={directCommand} />}
			</div>
		</div>
	);
}
