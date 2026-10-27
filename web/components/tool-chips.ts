/** `ToolChipsContext`, the chips a page around a conversation adds under its transcript's tool groups, as a Bot's page does for `remember`. */
import type { LucideIcon } from "lucide-react";
import { createContext } from "react";

/** For each tool named here, a chip under the tool group of its finished calls, such as "Updated memory for Scout" for `remember`. */
export type ToolChipLabels = Readonly<Record<string, { label: string; icon: LucideIcon }>>;

export const ToolChipsContext = createContext<ToolChipLabels>({});
