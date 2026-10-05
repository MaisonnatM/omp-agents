import { Brain } from "lucide-react";
import type { ModelOption } from "../../src/shared";
import type { ModelList } from "../reads";
import { Model, ModelPicker } from "./model-picker";
import type { Subject } from "./subject";

interface ModelSlotProps {
	subject: Subject;
	/** The last model list the server sent for this session; nothing while none has arrived. */
	models: ModelList;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Switch to `model` and, when `thinking` names one, thinking level. */
	onSetModel: (model: ModelOption, thinking: string | null) => void;
	onSetThinking: (level: string) => void;
	/** A model switch is in flight, so thinking changes wait. */
	switching: boolean;
	onBeginSwitch: () => void;
}

/** The composer's model and thinking-level switches for a session this dashboard started; what a terminal session reports, read-only; nothing for a subagent. */
export function ModelSlot({ subject, models, open, onOpenChange, onSetModel, onSetThinking, switching, onBeginSwitch }: ModelSlotProps) {
	if (subject.kind !== "session") return null;
	const model = subject.shown?.model ?? null;
	const thinking = subject.shown?.thinkingLevel ?? null;
	const { switchable } = subject;
	if (switchable) {
		return (
			<ModelPicker
				current={model}
				list={models}
				open={open}
				onOpenChange={onOpenChange}
				onPick={picked => {
					if (switching) return;
					onBeginSwitch();
					onSetModel(picked, null);
				}}
				thinking={{
					current: thinking,
					levels: switchable.thinkingLevels,
					pending: switching,
					onPick: level => {
						if (level !== null && !switching) onSetThinking(level);
					},
				}}
			/>
		);
	}
	if (!model && !thinking) return null;
	return (
		<span className="flex min-w-0 items-center gap-3 px-2 text-xs text-muted-foreground" title="Switch this session's model and thinking level from its omp terminal.">
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
	);
}
