import { useCallback, useMemo, useState } from "react";
import { type ActivityVisibility, HIDE_THINKING_KEY, HIDE_TOOL_CALLS_KEY } from "./components/transcript";
import { useStoredState } from "./stored-state";

/** How every transcript shows its tool calls and thinking, which the shortcuts and the palette toggle. */
export interface TranscriptDisplay {
	toolsExpanded: boolean;
	toggleTools: () => void;
	toggleHideTools: () => void;
	toggleHideThinking: () => void;
	/** What the transcripts read: whether tool calls and thinking hide, and the toggles that the activity groups carry. */
	activityVisibility: ActivityVisibility;
}

const decodeFlag = (raw: string | null): boolean => raw === "true";

export function useTranscriptDisplay(): TranscriptDisplay {
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [hideTools, setHideTools] = useStoredState(HIDE_TOOL_CALLS_KEY, decodeFlag);
	const [hideThinking, setHideThinking] = useStoredState(HIDE_THINKING_KEY, decodeFlag);
	const toggleTools = useCallback(() => setToolsExpanded(expanded => !expanded), []);
	const toggleHideTools = useCallback(() => setHideTools(value => !value), [setHideTools]);
	const toggleHideThinking = useCallback(() => setHideThinking(value => !value), [setHideThinking]);
	const activityVisibility = useMemo(
		(): ActivityVisibility => ({ hideTools, hideThinking, toggleTools: toggleHideTools, toggleThinking: toggleHideThinking }),
		[hideTools, hideThinking, toggleHideTools, toggleHideThinking],
	);
	return { toolsExpanded, toggleTools, toggleHideTools, toggleHideThinking, activityVisibility };
}
