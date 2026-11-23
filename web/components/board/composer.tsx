/** The Board's reply box: the session composer, with the Board's members behind `@` and its commands behind `/`. */
import { type KeyboardEvent, useRef, useState } from "react";
import { InputMessage } from "@/components/ui/input-message";
import { BOARD_COMMANDS, type BoardCommand, type Member, parseCommand } from "../../../src/shared/board";
import { boardMenu, type BoardTrigger, boardTrigger } from "../../board-composer";
import type { Tokenize } from "../../prompt-tokens";
import { useCompletionMenu } from "../completion-popup";
import type { PromptEditorHandle } from "../prompt-editor";

const QUICK = BOARD_COMMANDS.filter(command => command.quick);

export function Composer({ members, tokenize, channel, onPost, onCommand }: { members: readonly Member[]; tokenize: Tokenize; channel: string; onPost: (text: string) => void; onCommand: (command: BoardCommand, arg: string) => void }) {
	const [text, setText] = useState("");
	const editorRef = useRef<PromptEditorHandle>(null);
	const completion = useCompletionMenu<BoardTrigger>({
		editorRef,
		draft: text,
		setDraft: setText,
		open: (value, cursor) => {
			const trigger = boardTrigger(value, cursor);
			return trigger && boardMenu(value, trigger, members).length > 0 ? trigger : null;
		},
		list: trigger => ({ sections: [{ title: null, options: boardMenu(text, trigger, members) }], error: null }),
	});

	function send(value: string) {
		const trimmed = value.trim();
		if (!trimmed) return;
		const command = parseCommand(trimmed);
		if (command) onCommand(command.command, command.arg);
		else onPost(trimmed);
		setText("");
		completion.close();
	}

	return (
		<div className="shrink-0 pt-2 pb-[max(1.25rem,var(--toasts-clearance,0px))] transition-[padding] duration-200 max-phone:pb-5">
			<div className="relative mx-auto max-w-3xl px-6">
				{completion.popup}
				<InputMessage
					editorRef={editorRef}
					value={text}
					onValueChange={completion.onValueChange}
					onSend={send}
					tokenize={tokenize}
					minRows={2}
					placeholder={`Reply in #${channel}. @ to ping a person or agent, / for a workflow`}
					editorProps={{ ...completion.editorProps, onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void completion.onMenuKeyDown(event) }}
					leftSlot={QUICK.map(({ name }) => (
						<button
							key={name}
							type="button"
							onClick={() => {
								setText(`/${name} `);
								completion.close();
								requestAnimationFrame(() => editorRef.current?.select(name.length + 2));
							}}
							className="h-7 rounded-md px-2 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							/{name}
						</button>
					))}
				/>
			</div>
		</div>
	);
}
