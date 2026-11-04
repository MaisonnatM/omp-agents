/** What the New session page shows under the composer in place of its starters for a private draft: what ending it deletes, and what stays. */
import { Brain, FileCode, History, Lock, type LucideIcon, Trash2 } from "lucide-react";

/** A private draft's facts: what ending it deletes, and what stays. */
export function PrivateFacts({ personal }: { personal: boolean }) {
	const facts: { icon: LucideIcon; title: string; text: string }[] = [
		{ icon: History, title: "Not in Past sessions", text: "It never shows there, and you cannot resume it." },
		{ icon: Trash2, title: "Deleted when it ends", text: "Its conversation, its subagents, and its prompts in history go with it." },
		personal
			? { icon: Brain, title: "Memory stays on", text: "It still reads what it knows about you and can add to it." }
			: { icon: FileCode, title: "Your files stay", text: "Files it changes and commits it makes stay in the project." },
	];
	return (
		<section aria-label="What a private session keeps" className="mt-4">
			<div className="mb-2 px-1">
				<h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
					<Lock aria-hidden className="size-3.5 text-muted-foreground" />
					{personal ? "Private, personal" : "Private session"}
				</h2>
			</div>
			<ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{facts.map(({ icon: Icon, title, text }) => (
					<li key={title} className="rounded-xl bg-card/80 p-3 shadow-surface-2">
						<p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
							<Icon aria-hidden className="size-3.5 text-muted-foreground" />
							{title}
						</p>
						<p className="text-xs text-pretty text-muted-foreground">{text}</p>
					</li>
				))}
			</ul>
		</section>
	);
}
