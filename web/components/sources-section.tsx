/** The changes card's Sources section: a row per web page or remote item the view's agents opened, which opens it in the browser. */
import { Globe } from "lucide-react";
import { useState } from "react";
import type { AgentSource } from "../../src/shared/transcript";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { mediaSrc } from "../api";
import { age } from "../labels";

/** `url` as its host, then its path, query, and fragment muted, without the scheme or a lone `/`. */
function labelOf(url: string): { hostname: string; host: string; rest: string } {
	const parsed = new URL(url);
	const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
	return { hostname: parsed.hostname, host: parsed.host.replace(/^www\./, ""), rest };
}

/** Who opened the source, with which tool, what the call said it did, and how long ago. */
const captionOf = (source: AgentSource): string =>
	[source.agentId ?? "Main agent", source.tool, source.summary, `${age(source.at)} ago`].filter(Boolean).join(" · ");

/** The site's icon, fetched by the server, or a globe when the server finds none. */
function SiteIcon({ hostname }: { hostname: string }) {
	const [failed, setFailed] = useState(false);
	if (failed) return <Globe aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
	return <img alt="" src={mediaSrc(`/api/favicon?${new URLSearchParams({ host: hostname })}`)} onError={() => setFailed(true)} className="size-3.5 shrink-0 rounded-[3px] object-contain" />;
}

export function SourceList({ sources }: { sources: AgentSource[] }) {
	return (
		<ul aria-label="Sources" className="px-1 py-1">
			{sources.map(source => {
				const { hostname, host, rest } = labelOf(source.url);
				return (
					<li key={source.url}>
						<Tooltip content={`${source.url} · ${captionOf(source)}`} side="left">
							<a
								{...activityControl("changes-card.source")}
								href={source.url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
							>
								<SiteIcon hostname={hostname} />
								<span className="min-w-0 truncate">
									<span className="text-foreground">{host}</span>
									{rest && <span className="text-muted-foreground">{rest}</span>}
								</span>
							</a>
						</Tooltip>
					</li>
				);
			})}
		</ul>
	);
}
