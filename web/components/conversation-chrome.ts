/** `ConversationChrome`, what a page around a conversation puts in place of its usual chrome, as a Bot's page does. */
import type { LucideIcon } from "lucide-react";
import { createContext } from "react";

/** A page that provides it draws its own header above the conversation, so the conversation draws none. */
export interface ConversationChrome {
	/** The composer's placeholder while the session waits on a message. */
	placeholder: string;
	/** For each tool named here, a chip under the tool group of its finished calls, such as "Updated memory for Scout" for `remember`. */
	toolChips: Readonly<Record<string, { label: string; icon: LucideIcon }>>;
}

export const ConversationChromeContext = createContext<ConversationChrome | null>(null);
