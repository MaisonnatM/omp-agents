/** The pieces a project's cards share: the card, its empty note, the add field at its foot, a line's hover actions, and a status badge. */
import { IconTrashCan } from "central-icons";
import { type ComponentType, type ReactNode, useState } from "react";
import { collapseSpaces } from "../../../src/shared/collapse-spaces";
import type { ProjectChange } from "../../../src/shared/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";

/** The toast id of a project's **Undo**, so a later removal replaces the last one's offer. */
export const PROJECT_UNDO = "project-undo";

/** Sends a change to the open project; the page shows it before the server answers. */
export type OnProjectChange = (change: ProjectChange) => void;

export function Card({ title, meta, action, children }: { title: string; meta?: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-border bg-background">
			<div className="flex h-12 items-center gap-2 border-b border-border px-4">
				<h3 className="text-sm font-semibold">{title}</h3>
				{meta && <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>}
				{action && <div className="ml-auto flex items-center">{action}</div>}
			</div>
			{children}
		</section>
	);
}

/** What a card says while it holds nothing. */
export function EmptyNote({ children }: { children: ReactNode }) {
	return <p className="px-4 py-3 text-sm text-pretty text-muted-foreground">{children}</p>;
}

/** Running or ended, for a session; open or archived, for a project. */
export function StatusBadge({ on, children }: { on: boolean; children: ReactNode }) {
	return (
		<Badge variant="dot" size="compact" color={on ? "green" : "gray"}>
			{children}
		</Badge>
	);
}

/** A line's icon button that shows while the line is hovered or focused, and always on touch. */
export function RowAction({ control, tooltip, label, icon: Icon, onClick }: { control: Parameters<typeof activityControl>[0]; tooltip: string; label: string; icon: ComponentType; onClick: () => void }) {
	return (
		<Tooltip content={tooltip}>
			<Button
				{...activityControl(control)}
				variant="ghost"
				size="icon-xs"
				aria-label={label}
				className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
				onClick={onClick}
			>
				<Icon />
			</Button>
		</Tooltip>
	);
}

export function RemoveButton({ control, label, onClick }: { control: "projects.step.remove" | "projects.decision.remove"; label: string; onClick: () => void }) {
	return <RowAction control={control} tooltip="Remove" label={label} icon={IconTrashCan} onClick={onClick} />;
}

/** A card's foot: a field that adds a line on Enter and empties for the next one; its text lines up with the card's title. */
export function AddLine({ control, label, onAdd }: { control: "projects.step.add" | "projects.decision.add" | "projects.log.add"; label: string; onAdd: (text: string) => void }) {
	const [text, setText] = useState("");
	return (
		<div className="flex flex-col border-t border-border px-3 py-1.5">
			<input
				{...activityControl(control)}
				aria-label={label}
				placeholder={`${label}…`}
				value={text}
				onChange={event => setText(event.target.value)}
				onKeyDown={event => {
					if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
					const line = collapseSpaces(text);
					if (!line) return;
					onAdd(line);
					setText("");
				}}
				className="h-7 rounded-md bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground hover:bg-accent/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
	);
}
