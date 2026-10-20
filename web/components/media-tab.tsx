import { Images, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { View } from "../../src/shared/sessions";
import type { AgentMedia } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { SidebarGroup } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { age } from "../labels";
import { useDashboardActions } from "./dashboard-context";
import { DetailsEmpty } from "./details-sidebar-frame";
import { ImageViewer } from "./media-viewer";

const agentName = (media: AgentMedia): string => media.agentId ?? "Main agent";

/** Who took the image, with which tool, and what the call said it did. */
const captionOf = (media: AgentMedia): string => [agentName(media), media.tool, media.summary].filter(Boolean).join(" · ");

/** Names one image across updates: a new one arrives at the top, so its place in the list does not name it. */
const mediaKey = (media: AgentMedia): string => `${media.agentId}:${media.at}:${media.src}`;

/** One image large, with what took it, the images before and after it, and a way to the agent's conversation. */
function MediaViewer({ media, index, view, onShow }: { media: AgentMedia[]; index: number; view: View; onShow: (key: string | null) => void }) {
	const { open } = useDashboardActions();
	const shown = media[index]!;
	const agentView: View | null = view.kind === "live" && shown.agentId !== view.agentId ? { ...view, agentId: shown.agentId } : null;
	return (
		<ImageViewer
			src={shown.src}
			caption={captionOf(shown)}
			index={index}
			count={media.length}
			detail={new Date(shown.at).toLocaleString()}
			previousLabel="Newer image"
			nextLabel="Older image"
			onIndex={next => onShow(mediaKey(media[next]!))}
			onClose={() => onShow(null)}
			actions={
				agentView && (
					<Button
						variant="ghost"
						size="compact"
						leadingIcon={MessageSquare}
						onClick={() => {
							onShow(null);
							open(agentView, "replace");
						}}
					>
						Open agent
					</Button>
				)
			}
		/>
	);
}

/** The images the view's agent and its subagents' tools returned, newest first, as thumbnails that open large. */
export function MediaTab({ media, view }: { media: AgentMedia[] | null; view: View }) {
	const [selected, setSelected] = useState<string | null>(null);
	if (!media) return null;
	if (media.length === 0) return <DetailsEmpty icon={Images} title="No images yet" description="Screenshots and images the agent's tools return show here." />;
	const index = selected === null ? -1 : media.findIndex(item => mediaKey(item) === selected);
	return (
		<SidebarGroup>
			<ul className="grid grid-cols-2 gap-2 px-2 py-1" aria-label="Images, newest first">
				{media.map(item => (
					<li key={mediaKey(item)} className="min-w-0">
						<Tooltip content={captionOf(item)} side="left">
							<button
								type="button"
								onClick={() => setSelected(mediaKey(item))}
								className="group flex w-full flex-col gap-1 rounded-md p-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
							>
								<img src={item.src} alt={item.summary || `Image from ${agentName(item)}`} loading="lazy" className="aspect-video w-full rounded-sm border border-border bg-muted object-cover object-top" />
								<span className="flex min-w-0 items-baseline gap-1 text-xs">
									<span className="min-w-0 flex-1 truncate text-foreground">{agentName(item)}</span>
									<span className="shrink-0 tabular-nums text-muted-foreground">{age(item.at)}</span>
								</span>
							</button>
						</Tooltip>
					</li>
				))}
			</ul>
			{index >= 0 && <MediaViewer media={media} index={index} view={view} onShow={setSelected} />}
		</SidebarGroup>
	);
}
