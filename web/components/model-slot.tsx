import { useState } from "react";
import { Brain } from "lucide-react";
import type { ModelOption } from "../../src/shared/models";
import { Tooltip } from "@/components/ui/tooltip";
import type { ModelList } from "../reads";
import { Model, type ModelMenuOpen, ModelPicker } from "./model-picker";
import type { Subject } from "./subject";

interface ModelSlotProps {
	subject: Subject;
	/** The last model list the server sent for this session; nothing while none has arrived. */
	models: ModelList;
	open: ModelMenuOpen | null;
	onOpenChange: (open: ModelMenuOpen | null) => void;
	/** Switch to `model` and, when `thinking` names one, thinking level. */
	onSetModel: (model: ModelOption, thinking: string | null) => void;
	onSetThinking: (level: string) => void;
	onSetFast: (enabled: boolean) => void;
	/** A model switch is in flight, so thinking changes wait. */
	switching: boolean;
}

/** The composer's model menu for a session this dashboard started; what a terminal session reports, read-only; nothing for a subagent. */
export function ModelSlot({ subject, models, open, onOpenChange, onSetModel, onSetThinking, onSetFast, switching }: ModelSlotProps) {
	if (subject.kind !== "session") return null;
	const model = subject.shown?.model ?? null;
	const thinking = subject.shown?.thinkingLevel ?? null;
	const { switchable } = subject;
	if (switchable) {
		return <SwitchableModelSlot model={model} thinking={thinking} models={models} open={open} onOpenChange={onOpenChange} onSetModel={onSetModel} onSetThinking={onSetThinking} onSetFast={onSetFast} switching={switching} switchable={switchable} />;
	}
	if (!model && !thinking) return null;
	return (
		<Tooltip content={`${[model, thinking].filter(Boolean).join(" · ")}. Switch this session's model and thinking level from its omp terminal.`}>
			<span className="flex min-w-0 items-center gap-3 px-2 text-xs text-muted-foreground">
				{model && (
					<span className="truncate">
						<Model selector={model} />
					</span>
				)}
				{thinking && (
					<span className="flex shrink-0 items-center gap-1">
						<Brain aria-hidden="true" className="size-3.5" />
						<span className="sr-only">Thinking level:</span>
						{thinking}
					</span>
				)}
			</span>
		</Tooltip>
	);
}

function SwitchableModelSlot({ model, thinking, models, open, onOpenChange, onSetModel, onSetThinking, onSetFast, switching, switchable }: Omit<ModelSlotProps, "subject"> & { model: string | null; thinking: string | null; switchable: NonNullable<Extract<Subject, { kind: "session" }>["switchable"]> }) {
	const [sentOn, setSentOn] = useState<typeof switchable | null>(null);
	// A fast switch can finish before the debounced roster ever publishes `switching: true`.
	// Keep the local pending state through the next roster row, including on failure.
	const pending = switching || sentOn === switchable;
	return (
		<ModelPicker
			current={model}
			list={models}
			open={open}
			onOpenChange={onOpenChange}
			onPick={picked => {
				if (pending) return;
				setSentOn(switchable);
				onSetModel(picked, null);
			}}
			pending={pending}
			effort={{
				current: thinking,
				levels: switchable.thinkingLevels,
				onPick: level => {
					if (level !== null && !pending) onSetThinking(level);
				},
			}}
			fast={{ state: switchable.fast, onChange: onSetFast }}
		/>
	);
}
