/** The cards a Board message carries under its text: a workflow's steps, or a scheduled follow-up. */
import { IconCalendar1, IconCheckmark1 } from "central-icons";
import { cn } from "@/lib/utils";
import { type Attachment, repeatLabel, type StepState } from "../../../src/shared/board";
import { Chip, relTime } from "./parts";

/** What a list's preview says for a message that has only its card. */
export function attachmentLabel(attachment?: Attachment) {
	if (!attachment) return "";
	return { workflow: "Ran a workflow", schedule: "Scheduled a follow-up" }[attachment.kind];
}

export function AttachmentCard({ attachment, now }: { attachment: Attachment; now: number }) {
	const frame = "mt-2 max-w-xl rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]";
	switch (attachment.kind) {
		case "workflow":
			return (
				<div className={cn(frame, "p-3")}>
					<p className="mb-2 flex items-center gap-2 text-xs">
						<span className="font-mono font-medium text-violet-700 dark:text-violet-300">{attachment.command}</span>
						<span className="text-muted-foreground">{attachment.steps.every(step => step.state === "done") ? "finished" : "running"}</span>
					</p>
					<ol className="space-y-1.5">
						{attachment.steps.map(step => (
							<li key={step.label} className="flex items-center gap-2 text-sm">
								<StepDot state={step.state} />
								<span className={cn(step.state === "queued" && "text-muted-foreground")}>{step.label}</span>
							</li>
						))}
					</ol>
				</div>
			);
		case "schedule":
			return (
				<div className={cn(frame, "flex items-center gap-3 p-3 text-sm")}>
					<IconCalendar1 className="size-4 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">{attachment.text}</span>
					<Chip>{attachment.every ? repeatLabel(attachment.every) : relTime(attachment.at, now)}</Chip>
				</div>
			);
	}
}

function StepDot({ state }: { state: StepState }) {
	if (state === "done")
		return (
			<span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white">
				<IconCheckmark1 className="size-2.5" />
			</span>
		);
	if (state === "running") return <span className="size-4 rounded-full border-2 border-sky-500 border-t-transparent motion-safe:animate-spin" />;
	if (state === "failed") return <span className="size-4 rounded-full bg-red-500" />;
	return <span className="size-4 rounded-full border border-dashed border-muted-foreground/50" />;
}
