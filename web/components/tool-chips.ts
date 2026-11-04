/** `ToolChipsContext`, the chips a page around a conversation adds under its transcript's tool groups, as a Bot's page does for `remember` and `message_bot`. */
import type { LucideIcon } from "lucide-react";
import { createContext } from "react";
import type { ToolItem } from "../transcript-view";

/**
 * For each tool named here, a chip under the tool group of its finished calls, labeled from the call, such as "Updated
 * memory for Scout" for `remember` or "Messaged Relay" for `message_bot`; calls with the same label share one chip.
 */
export type ToolChipLabels = Readonly<Record<string, { label: (tool: ToolItem) => string; icon: LucideIcon }>>;

export const ToolChipsContext = createContext<ToolChipLabels>({});
