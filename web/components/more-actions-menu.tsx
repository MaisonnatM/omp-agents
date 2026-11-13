import { IconDotGrid1x3Horizontal } from "central-icons";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";

/** A ⋯ menu for `name`'s actions too rare to sit beside it. */
export function MoreActionsMenu({ name, disabled, children }: { name: string; disabled?: boolean; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="More actions" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<Button variant="ghost" size="icon-compact" aria-label={`More actions for ${name}`} disabled={disabled} />}>
					<IconDotGrid1x3Horizontal />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">{children}</DropdownMenuContent>
		</DropdownMenu>
	);
}
