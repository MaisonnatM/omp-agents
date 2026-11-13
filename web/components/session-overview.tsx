/** The right sidebar's **Overview** tab: the view's subagents, then the files, images, and pages its agents changed, took, and opened. */
import { IconBulletList } from "central-icons";
import type { View } from "../../src/shared/sessions";
import { subagentTree } from "../overview-subagents-model";
import { DetailsEmpty } from "./details-sidebar-frame";
import { type ChangesSession, ChangesSections, useChanges } from "./overview-changes";
import { SubagentsSection } from "./overview-subagents";
import type { SubagentLinksValue } from "./subagent-links";

interface SessionOverviewProps {
	view: View;
	/** A turn that starts or ends reads the session's changes again. */
	working: boolean;
	/** The live session's subagents; `null` for a past session. */
	links: SubagentLinksValue | null;
	changes: ChangesSession;
}

/** Each section shows once it has something to list, and the tab says so once the server has sent the lists and none has. */
export function SessionOverview({ view, working, links, changes }: SessionOverviewProps) {
	const nodes = links ? subagentTree(links.agents, view.kind === "live" ? view.agentId : null) : [];
	const found = useChanges(view, changes);
	if (nodes.length === 0 && found === undefined) return null;
	if (nodes.length === 0 && found === null) {
		const description = links ? "The session's subagents, and the files, images, and pages its agents touch, show here." : "The files, images, and pages this session's agents touched show here.";
		return <DetailsEmpty icon={IconBulletList} title="Nothing yet" description={description} />;
	}
	return (
		<div className="flex flex-col gap-2 px-2 pb-4">
			{links && nodes.length > 0 && <SubagentsSection links={links} nodes={nodes} arenas={changes.facts?.arenas ?? []} />}
			{found && <ChangesSections view={view} session={changes} changes={found} working={working} />}
		</div>
	);
}
