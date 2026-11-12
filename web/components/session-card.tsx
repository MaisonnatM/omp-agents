import { LayoutList } from "lucide-react";
import { memo, useLayoutEffect } from "react";
import type { View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { keyedStore } from "../keyed-store";
import { hashForView } from "../routing";
import { useStoredState } from "../stored-state";
import { subagentTree } from "../session-card-subagents-model";
import type { SubagentLinksValue } from "./subagent-links";
import { type ChangesSession, ChangesSections, useChanges } from "./session-card-changes";
import { SubagentsSection } from "./session-card-subagents";

/** Keeps the card's old name, the Todos card, so the stored choice survives the rename. */
const SHOWN_KEY = "omp-agents.todos-card-shown";

/** Whether transcripts show the whole Session card, which the card toggle in the session header and Settings → Preferences both toggle. */
export const useSessionCardShown = () => useStoredState(SHOWN_KEY, raw => raw !== "false");

/** Per view hash, how many mounted Session cards have a section to show, so the header toggle shows only while one could appear. */
const filledCards = keyedStore(0);

/** The session header's card toggle, pressed while the Session card shows in every pane, and absent while the view's card has nothing to show. */
export function SessionCardToggle({ view }: { view: View }) {
	const [shown, setShown] = useSessionCardShown();
	const filled = filledCards.use(hashForView(view)) > 0;
	if (!filled) return null;
	return (
		<Tooltip content={shown ? "Hide the session card" : "Show the session card: subagents, files, images, and sources"} side="bottom">
			<Button
				{...activityControl("todos-card.toggle")}
				variant="ghost"
				size="icon-compact"
				aria-label="Session card"
				aria-pressed={shown}
				active={shown}
				onClick={() => setShown(value => !value)}
			>
				<LayoutList />
			</Button>
		</Tooltip>
	);
}

interface SessionCardProps {
	view: View;
	working: boolean;
	/** The session whose files, images, and sources the card lists; omitted, it lists none. */
	changes?: ChangesSession;
	/** The live session's subagents, listed in their own section; `null` in a past session or where activity is hidden. */
	subagents: SubagentLinksValue | null;
}

/**
 * The subagents under the view's agent, and the files, images, and pages the view's agents changed, took, and opened,
 * each a section shown once it has something to list.
 * The card floats at the top right of its transcript when the transcript is wide enough to keep it beside the messages,
 * and otherwise sits above them.
 */
export const SessionCard = memo(function SessionCard({ view, working, changes, subagents }: SessionCardProps) {
	const [shown] = useSessionCardShown();
	const found = useChanges(view, changes);
	const nodes = subagents ? subagentTree(subagents.agents, view.kind === "live" ? view.agentId : null) : [];
	const filled = nodes.length > 0 || found !== null;
	const key = hashForView(view);
	useLayoutEffect(() => {
		if (!filled) return;
		filledCards.set(key, filledCards.get(key) + 1);
		return () => filledCards.set(key, filledCards.get(key) - 1);
	}, [key, filled]);
	if (!shown || !filled) return null;
	return (
		<section
			aria-label="Session card"
			data-session-card
			className="mx-auto mt-3 max-h-[45%] min-h-0 w-[calc(100%-1.5rem)] max-w-[calc(var(--container-conversation)-1.5rem)] shrink-0 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-popover/95 text-popover-foreground shadow-sm backdrop-blur [scrollbar-width:thin] @min-[65.75rem]/conversation:absolute @min-[65.75rem]/conversation:top-3 @min-[65.75rem]/conversation:right-3 @min-[65.75rem]/conversation:z-10 @min-[65.75rem]/conversation:m-0 @min-[65.75rem]/conversation:max-h-[calc(100%-5rem)] @min-[65.75rem]/conversation:w-80 @min-[65.75rem]/conversation:max-w-none"
		>
			{subagents && nodes.length > 0 && <SubagentsSection links={subagents} nodes={nodes} arenas={changes?.facts?.arenas ?? []} />}
			{found && changes && <ChangesSections view={view} session={changes} changes={found} working={working} />}
		</section>
	);
});
