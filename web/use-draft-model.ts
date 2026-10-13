import { type ComponentProps, useState } from "react";
import { type ConnectedModels, type ModelOption, type ModelRole, selectorOf } from "../src/shared/models";
import type { ModelMenuOpen, ModelPicker } from "./components/model-picker";
import { useRead } from "./reads";

interface PickedEffort {
	model: string;
	level: string;
}

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
 * The model and effort of a draft that starts omp in `cwd`: the new-session draft and a new project's coordinator.
 * Until a pick, omp starts on the model its `default` role names, so the picker shows that one, and an effort holds only for
 * the model it was picked on, the default one included. `initial` is a failed start's model and level, so a retry keeps them.
 */
export function useDraftModelSelection(cwd: string, initial: { model: ModelOption | null; thinking: string | null } = { model: null, thinking: null }): DraftModelSelection {
	const [model, setModel] = useState(initial.model);
	const [picked, setPicked] = useState<PickedEffort | null>(initial.model && initial.thinking !== null ? { model: selectorOf(initial.model), level: initial.thinking } : null);
	// A failed start on omp's default holds its level for the default model of the same directory, known once its roles are read.
	const [unbound, setUnbound] = useState(initial.model === null && initial.thinking !== null ? { cwd, level: initial.thinking } : null);
	const roles = useRead<{ roles: ModelRole[] }>(`/api/models/roles?cwd=${encodeURIComponent(cwd)}`);
	const shown = model ?? roles.data?.roles.find(role => role.role === "default")?.model ?? null;
	const selector = shown && selectorOf(shown);
	if (unbound !== null && (unbound.cwd !== cwd || selector !== null)) {
		setUnbound(null);
		if (unbound.cwd === cwd && selector !== null) setPicked({ model: selector, level: unbound.level });
	}
	const [open, setOpen] = useState<ModelMenuOpen | null>(null);
	// Reopening reads credentials and model capabilities again after a provider login.
	const [opens, setOpens] = useState(0);
	const list = useRead<ConnectedModels>(`/api/models/connected?cwd=${encodeURIComponent(cwd)}`, opens);
	const known = list.data?.models.find(entry => selectorOf(entry) === selector)?.thinkingLevels ?? null;
	const levels = list.error === null ? known : [];
	const thinking = picked !== null && picked.model === selector && known?.includes(picked.level) ? picked.level : null;
	const pickThinking = (level: string | null): void => {
		setUnbound(null);
		setPicked(level !== null && selector !== null ? { model: selector, level } : null);
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
			onPick: next => {
				setModel(next);
				setUnbound(null);
				setPicked(null);
			},
			effort: { current: thinking, levels, onPick: pickThinking, allowDefault: true },
		},
	};
}
