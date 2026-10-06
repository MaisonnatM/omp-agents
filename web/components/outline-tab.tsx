import { useReducedMotion } from "framer-motion";
import { Bot, type LucideIcon, User } from "lucide-react";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { skillLabel } from "../labels";
import type { OutlineEntry } from "../transcript-view";

const KIND_LOOK: Record<OutlineEntry["kind"], { icon: LucideIcon; label: string }> = {
	prompt: { icon: User, label: "Prompt" },
	reply: { icon: Bot, label: "Reply" },
};

/** The transcript's own top padding, kept above the message so it does not sit under the viewport's edge fade. */
const SCROLL_GAP = 12;

/**
 * Scrolls the focused pane's transcript to a message. It sets the transcript's viewport alone, since
 * `scrollIntoView` would also scroll the pane's clipped ancestors.
 */
function scrollToMessage(id: string, behavior: ScrollBehavior): void {
	const message = document.querySelector<HTMLElement>(`[data-pane][data-focused] [data-message-id="${CSS.escape(id)}"]`);
	const viewport = message?.closest<HTMLElement>('[data-slot="message-scroller-viewport"]');
	if (!message || !viewport) return;
	const top = viewport.scrollTop + message.getBoundingClientRect().top - viewport.getBoundingClientRect().top - SCROLL_GAP;
	viewport.scrollTo({ top, behavior });
}

/** A reply's start padding, in px, which indents it under its prompt. */
const REPLY_INDENT = 20;

/** A reply's markdown read as the words it renders, on one line, so `**Résumé**` reads as `Résumé`. */
const plain = (text: string): string =>
	text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
		.replace(/\*\*|__|`/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** Cut long before the row would show it all, so a long reply's accessible name stays short. */
const excerpt = (text: string): string => plain(text).slice(0, 200);

/** The view's prompts and the replies that end its turns, in order; a row scrolls the pane's transcript to its message. */
export function OutlineTab({ entries, loaded }: { entries: OutlineEntry[]; loaded: boolean }) {
	const reduceMotion = useReducedMotion() ?? false;
	if (!loaded) return <p className="px-4 py-2 text-sm text-muted-foreground">Loading the conversation…</p>;
	if (entries.length === 0) return <p className="px-4 py-2 text-sm text-muted-foreground">No messages yet.</p>;
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Conversation outline">
				{entries.map(entry => {
					const look = KIND_LOOK[entry.kind];
					const skill = entry.skill && skillLabel(entry.skill);
					return (
						<SidebarMenuItem key={entry.id}>
							<SidebarMenuButton
								icon={look.icon}
								title={[skill, plain(entry.text)].filter(Boolean).join(" · ")}
								onClick={() => scrollToMessage(entry.id, reduceMotion ? "auto" : "smooth")}
								style={entry.kind === "reply" ? { paddingInlineStart: REPLY_INDENT } : undefined}
							>
								<span className="sr-only">{look.label}: </span>
								{skill && <span className="shrink-0 font-medium text-foreground">{skill}</span>}
								<span className="min-w-0 flex-1 truncate">{excerpt(entry.text)}</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
