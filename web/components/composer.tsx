import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

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
					["@", "files"],
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
