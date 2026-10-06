import { FileDiff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { hashForChanges } from "../../routing";

/** A session header's way to the files it changed. */
export function ChangesLink({ sessionId }: { sessionId: string }) {
	return (
		<Tooltip content="The files this session changed, as an editor shows them" side="bottom">
			<Button variant="ghost" size="compact" leadingIcon={FileDiff} asChild>
				<a href={hashForChanges(sessionId)}>Changes</a>
			</Button>
		</Tooltip>
	);
}
