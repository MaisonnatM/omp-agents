import { Folder, MessageCircle } from "lucide-react";
import { createContext, type ReactNode, type RefObject } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { folderName } from "../labels";
import type { PromptEditorHandle } from "./prompt-editor";

/** The text field of the composer around a picker, which takes the focus back once a choice closes the picker; `null` outside a composer. */
export const ComposerEditor = createContext<RefObject<PromptEditorHandle | null> | null>(null);

/** Where a draft goes: a session this dashboard started, which runs `!` over RPC; a draft that starts one; or a Collab room or a subagent. */
export type ShellReach = "rpc" | "new" | "none";

/** Why the composer holds back a draft that starts with one of omp's terminal shortcuts, or `null` when it can send it. */
export function blockedShortcut(draft: string, shell: ShellReach): string | null {
	if (draft.startsWith("$")) return "Direct Python execution needs the omp terminal.";
	if (!draft.startsWith("!")) return null;
	if (shell === "none") return "Direct shell execution needs the omp terminal. Collab cannot run it here.";
	if (shell === "new") return "Start the session with a prompt. A ! command runs once omp has replied.";
	return draft.startsWith("!!") ? "omp's RPC mode cannot keep a command's output out of context. Use ! or the omp terminal." : null;
}

export const ComposerNote = ({ text }: { text: string }) => (
	<p role="status" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
		{text}
	</p>
);

/** The class that lifts the composer's frame over the {@link ComposerTray} tucked under its bottom edge. */
export const OVER_TRAY = "relative z-10";

/** The strip tucked under the composer's frame: where the session works on the left, its context counter on the right. */
export const ComposerTray = ({ start, end }: { start: ReactNode; end?: ReactNode }) => (
	<div className="mx-3 -mt-4 flex min-h-12 items-center justify-between gap-2 rounded-b-xl bg-muted px-1.5 pt-5 pb-1">
		<div className="flex min-w-0 items-center gap-1">{start}</div>
		{end && <div className="flex shrink-0 items-center gap-1">{end}</div>}
	</div>
);

/** A directory the session cannot move from, by its folder name; the tooltip holds the whole path. */
export const DirectoryLabel = ({ cwd }: { cwd: string }) => (
	<Tooltip content={cwd} side="top">
		<span tabIndex={0} className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<Folder aria-hidden="true" className="size-4 shrink-0" />
			<span className="truncate">{folderName(cwd) ?? cwd}</span>
		</span>
	</Tooltip>
);

/** A conversation with no messages yet: what sending the first one does, and the composer's completions. */
export function EmptyConversation({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="m-auto flex max-w-sm flex-col items-center gap-4 px-6 py-8 text-center" data-empty-conversation>
			<span className="flex size-10 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
				<MessageCircle aria-hidden="true" className="size-5" />
			</span>
			<div className="space-y-1">
				<h2 className="text-sm font-medium">{title}</h2>
				<p className="text-sm text-pretty text-muted-foreground">{children}</p>
			</div>
			<ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
				{[
					["/", "commands and skills"],
					["@", "files, todos, tickets, PRs, sessions"],
				].map(([key, label]) => (
					<li key={key} className="flex items-center gap-1.5">
						<kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-border bg-background px-1.5 font-sans text-xs text-foreground">
							{key}
						</kbd>
						{label}
					</li>
				))}
			</ul>
		</div>
	);
}
