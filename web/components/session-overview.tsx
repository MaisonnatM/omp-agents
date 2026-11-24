/** The right sidebar's **Overview** tab: the session's background jobs, the view's subagents, then the files, images, and pages its agents changed, took, and opened. */
import { IconBulletList } from "central-icons";
import { useContext } from "react";
import type { View } from "../../src/shared/sessions";
import { subagentTree } from "../overview-subagents-model";
import { DetailsEmpty } from "./details-sidebar-frame";
import { type ChangesSession, ChangesSections, useChanges } from "./overview-changes";
import { JobsContext } from "../jobs-context";
import { JobsSection } from "./overview-jobs";
import { SubagentsSection } from "./overview-subagents";
import type { SubagentLinksValue } from "./subagent-links";

interface SessionOverviewProps {
	view: View;
	/** A turn that starts or ends reads the session's changes again. */
	working: boolean;
	/** The live session's subagents; `null` for a past session. */
	links: SubagentLinksValue | null;
	session: ChangesSession;
}

/** Each section shows once it has something to list, and the tab says so once the server has sent the lists and none has. */
export function SessionOverview({ view, working, links, session }: SessionOverviewProps) {
	const nodes = links ? subagentTree(links.agents, view.kind === "live" ? view.agentId : null) : [];
	const { changes, loaded } = useChanges(view, session);
	// The jobs are the main agent's, so a subagent's view leaves them out.
	const jobs = useContext(JobsContext)[view.kind === "live" && view.agentId === null ? view.instanceId : ""] ?? [];
	if (jobs.length === 0 && nodes.length === 0 && changes.files.length + changes.media.length + changes.sources.length === 0) {
		if (!loaded) return null;
		const description = links ? "The session's subagents, and the files, images, and pages its agents touch, show here." : "The files, images, and pages this session's agents touched show here.";
		return <DetailsEmpty icon={IconBulletList} title="Nothing yet" description={description} />;
	}
	return (
		<div className="flex flex-col gap-2 px-2 pb-4">
			{jobs.length > 0 && <JobsSection jobs={jobs} />}
			{links && nodes.length > 0 && <SubagentsSection links={links} nodes={nodes} arenas={session.facts?.arenas ?? []} />}
			<ChangesSections view={view} session={session} changes={changes} working={working} />
		</div>
	);
}
