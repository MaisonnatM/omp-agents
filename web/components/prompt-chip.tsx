/** `PromptChip`, a skill, file, ticket, or other reference in a prompt drawn as one chip, in the composer and transcript. */
import { File, Folder, GitPullRequest, ListTodo, type LucideIcon, MessageSquare, Slash, Sparkles, SquareDashedMousePointer, Ticket, UserRound } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChipKind, PromptToken } from "../prompt-tokens";

const CHIP: Record<ChipKind, { icon: LucideIcon; name: string }> = {
	skill: { icon: Sparkles, name: "Skill" },
	command: { icon: Slash, name: "Command" },
	file: { icon: File, name: "File" },
	directory: { icon: Folder, name: "Folder" },
	ticket: { icon: Ticket, name: "Ticket" },
	"pull-request": { icon: GitPullRequest, name: "Pull request" },
	person: { icon: UserRound, name: "Person" },
	todo: { icon: ListTodo, name: "Todo" },
	session: { icon: MessageSquare, name: "Session" },
	annotation: { icon: SquareDashedMousePointer, name: "Browser annotation" },
};

export const isChipKind = (value: unknown): value is ChipKind => typeof value === "string" && Object.hasOwn(CHIP, value);

export type ChipProps = Pick<PromptToken, "kind" | "label" | "target">;

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What the tooltip names: the path a file chip shortens, the command a skill runs, the start of a Browser annotation's text, or the words a long label truncates. */
const detail = ({ kind, label, target }: ChipProps): string =>
	kind === "file" || kind === "directory"
		? target
		: kind === "skill"
			? `/skill:${target}`
			: kind === "annotation"
				? truncate(target.replace(/\s+/g, " "), 240)
				: label;

/** A reference in a prompt, drawn as one unit: the composer's chips and the transcript's. */
export function PromptChip(props: ChipProps) {
	const { icon: Icon, name } = CHIP[props.kind];
	return (
		<Tooltip content={detail(props)}>
			<span
				data-chip={props.kind}
				className="mx-px inline-flex max-w-[18rem] items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 align-bottom font-medium text-foreground ring-1 ring-border ring-inset"
			>
				<Icon aria-hidden className={cn("size-3 shrink-0", props.kind === "skill" ? "text-violet-500 dark:text-violet-400" : "text-muted-foreground")} />
				<span className="sr-only">{name}:</span>
				<span className="truncate">{props.label}</span>
			</span>
		</Tooltip>
	);
}
