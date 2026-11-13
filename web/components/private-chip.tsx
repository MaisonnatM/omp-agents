import { IconLock } from "central-icons";

/** A private session's mark in its sidebar row and conversation header: a filled chip, so it reads apart from workspace badges. */
export function PrivateChip() {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-1.5 py-px text-[10.5px] font-medium text-background">
			<IconLock className="size-2.5" />
			Private
		</span>
	);
}
