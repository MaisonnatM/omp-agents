/** The Overview tab's Sources section: a row per web page or remote item the view's agents opened, which opens it in the browser. */
import type { AgentSource } from "../../src/shared/transcript";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { age } from "../labels";
import { SiteAddress, SiteIcon } from "./site-icon";

/** Who opened the source, with which tool, what the call said it did, and how long ago. */
const captionOf = (source: AgentSource): string =>
	[source.agentId ?? "Main agent", source.tool, source.summary, `${age(source.at)} ago`].filter(Boolean).join(" · ");

export function SourceList({ sources }: { sources: AgentSource[] }) {
	return (
		<ul aria-label="Sources" className="px-1 py-1">
			{sources.map(source => {
				const { hostname } = new URL(source.url);
				return (
					<li key={source.url}>
						<Tooltip content={`${source.url} · ${captionOf(source)}`} side="left">
							<a
								{...activityControl("changes-card.source")}
								href={source.url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
							>
								<SiteIcon hostname={hostname} />
								<SiteAddress url={source.url} className="truncate" />
							</a>
						</Tooltip>
					</li>
				);
			})}
		</ul>
	);
}
