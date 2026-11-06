import { type ComponentProps, useState } from "react";
import { type ConnectedModels, type ModelOption, type ModelRole, selectorOf } from "../src/shared/models";
import type { ModelMenuOpen, ModelPicker } from "./components/model-picker";
import { useRead } from "./reads";

/**
 * The effort a start sends: one picked on a model, or a failed start's level waiting for the default model of `cwd` to
 * be known, which then pins it to that model; a move to another directory first drops it.
 */
type Effort = { kind: "picked"; model: string; level: string } | { kind: "for-default"; cwd: string; level: string } | null;

/** What a draft's {@link ModelPicker} takes, other than whether it is disabled. */
type DraftPicker = Pick<ComponentProps<typeof ModelPicker>, "current" | "unset" | "list" | "open" | "onOpenChange" | "onPick" | "effort">;

export interface DraftModelSelection {
	/** The model a start sends: the one picked, or `null`, which leaves omp's default. */
	model: ModelOption | null;
	/** The level a start sends, for the model the draft starts on; `null` leaves that model's default. */
	thinking: string | null;
	/** The levels the picker offers: `null` until the model's capabilities are known, none when the model list failed. */
	levels: string[] | null;
	pickThinking: (level: string | null) => void;
	/** Opens or closes the model menu; opening reads the model list again. */
	openModels: (open: ModelMenuOpen | null) => void;
	picker: DraftPicker;
}

/**
 * The model and effort of the new-session draft, which starts omp in `cwd`.
 * Until a pick, omp starts on the model its `default` role names, so the picker shows that one, and an effort holds only for
 * the model it was picked on, the default one included. `initial` is a failed start's model and level, so a retry keeps them.
 */
export function useDraftModelSelection(cwd: string, initial: { model: ModelOption | null; thinking: string | null } = { model: null, thinking: null }): DraftModelSelection {
	const [model, setModel] = useState(initial.model);
	const [effort, setEffort] = useState<Effort>(initial.thinking === null ? null : initial.model ? { kind: "picked", model: selectorOf(initial.model), level: initial.thinking } : { kind: "for-default", cwd, level: initial.thinking });
	const roles = useRead<{ roles: ModelRole[] }>(`/api/models/roles?cwd=${encodeURIComponent(cwd)}`);
	const shown = model ?? roles.data?.roles.find(role => role.role === "default")?.model ?? null;
	const selector = shown && selectorOf(shown);
	if (effort?.kind === "for-default" && (effort.cwd !== cwd || selector !== null)) setEffort(effort.cwd === cwd && selector !== null ? { kind: "picked", model: selector, level: effort.level } : null);
	const [open, setOpen] = useState<ModelMenuOpen | null>(null);
	// Reopening reads credentials and model capabilities again after a provider login.
	const [opens, setOpens] = useState(0);
	const list = useRead<ConnectedModels>(`/api/models/connected?cwd=${encodeURIComponent(cwd)}`, opens);
	const known = list.data?.models.find(entry => selectorOf(entry) === selector)?.thinkingLevels ?? null;
	const levels = list.error === null ? known : [];
	const thinking = effort?.kind === "picked" && effort.model === selector && known?.includes(effort.level) ? effort.level : null;
	const pickThinking = (level: string | null): void => setEffort(level !== null && selector !== null ? { kind: "picked", model: selector, level } : null);
	const pickModel = (next: ModelOption | null): void => {
		setModel(next);
		setEffort(null);
	};
	const openModels = (next: ModelMenuOpen | null): void => {
		if (next !== null && open === null) setOpens(count => count + 1);
		setOpen(next);
	};
	return {
		model,
		thinking,
		levels,
		pickThinking,
		openModels,
		picker: {
			current: selector,
			unset: "Default model",
			list,
			open,
			onOpenChange: openModels,
			onPick: pickModel,
			effort: { current: thinking, levels, onPick: pickThinking, allowDefault: true },
		},
	};
}
