/** `PromptChip`, a skill, file, ticket, or other reference in a prompt drawn as one unit, in the composer and transcript: an icon and a label in its kind's color. */
import { AtSign, Bot, CircleDot, FileText, FolderOpen, GitPullRequestArrow, type LucideIcon, MousePointerClick, SquareCheck, SquareTerminal, WandSparkles } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChipKind, PromptToken } from "../prompt-tokens";

/** The `$` menu's commands and skills share violet, as omp may list a skill as a command; light tones are -700 for AA contrast on the composer and prompt bubble. */
const CHIP: Record<ChipKind, { icon: LucideIcon; name: string; tone: string }> = {
	skill: { icon: WandSparkles, name: "Skill", tone: "text-violet-700 dark:text-violet-400" },
	command: { icon: SquareTerminal, name: "Command", tone: "text-violet-700 dark:text-violet-400" },
	file: { icon: FileText, name: "File", tone: "text-sky-700 dark:text-sky-400" },
	directory: { icon: FolderOpen, name: "Folder", tone: "text-sky-700 dark:text-sky-400" },
	ticket: { icon: CircleDot, name: "Ticket", tone: "text-fuchsia-700 dark:text-fuchsia-400" },
	"pull-request": { icon: GitPullRequestArrow, name: "Pull request", tone: "text-emerald-700 dark:text-emerald-400" },
	person: { icon: AtSign, name: "Person", tone: "text-rose-700 dark:text-rose-400" },
	todo: { icon: SquareCheck, name: "Todo", tone: "text-amber-700 dark:text-amber-400" },
	session: { icon: Bot, name: "Session", tone: "text-lime-700 dark:text-lime-400" },
	annotation: { icon: MousePointerClick, name: "Browser annotation", tone: "text-orange-700 dark:text-orange-400" },
};

export const isChipKind = (value: unknown): value is ChipKind => typeof value === "string" && Object.hasOwn(CHIP, value);

export type ChipProps = Pick<PromptToken, "kind" | "label" | "target">;

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What the tooltip names: the path a file chip shortens, the text a command or skill runs, the start of a Browser annotation's text, or the words a long label truncates. */
const detail = ({ kind, label, target }: ChipProps): string =>
	kind === "file" || kind === "directory"
		? target
		: kind === "skill"
			? `/skill:${target}`
			: kind === "command"
				? `/${target}`
				: kind === "annotation"
					? truncate(target.replace(/\s+/g, " "), 240)
					: label;

/** A reference in a prompt, drawn as one unit: the composer's chips and the transcript's. */
export function PromptChip(props: ChipProps) {
	const { icon: Icon, name, tone } = CHIP[props.kind];
	return (
		<Tooltip content={detail(props)}>
			<span data-chip={props.kind} className={cn("mx-px inline-flex max-w-[18rem] items-center gap-1 align-bottom font-medium", tone)}>
				<Icon aria-hidden className="size-3.5 shrink-0" />
				<span className="sr-only">{name}:</span>
				<span className="truncate">{props.label}</span>
			</span>
		</Tooltip>
	);
}
