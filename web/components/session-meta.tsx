/** The subagent header's crumb styles, and the copy-ID button both session headers show. */
import { IconCheckmark1, IconSquareBehindSquare1 } from "central-icons";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

import { useCopy } from "../use-copy";

export const PARENT_CRUMB = "font-normal text-muted-foreground";
export const CRUMB_SEPARATOR = "px-1.5 font-normal text-muted-foreground/60";

/** A session header's ID, as an icon button right after its title that copies the ID. */
export function SessionIdCopy({ id }: { id: string }) {
	const { copied, copy } = useCopy();
	const Icon = copied ? IconCheckmark1 : IconSquareBehindSquare1;
	const label = copied ? "Copied" : `Copy session ID ${id}`;
	return (
		<Tooltip content={label}>
			<Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => copy(id)} className="text-muted-foreground">
				<Icon aria-hidden />
			</Button>
		</Tooltip>
	);
}
