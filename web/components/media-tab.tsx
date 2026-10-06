import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ExternalLink, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import type { View } from "../../src/shared/sessions";
import type { AgentMedia } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { SidebarGroup } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { age } from "../labels";
import { useDashboardContext } from "./dashboard-context";

const agentName = (media: AgentMedia): string => media.agentId ?? "Main agent";

/** Who took the image, with which tool, and what the call said it did. */
const captionOf = (media: AgentMedia): string => [agentName(media), media.tool, media.summary].filter(Boolean).join(" · ");

/** Names one image across updates: a new one arrives at the top, so its place in the list does not name it. */
const mediaKey = (media: AgentMedia): string => `${media.agentId}:${media.at}:${media.src}`;

/** One image large, with what took it, the images before and after it, and a way to the agent's conversation. */
function MediaViewer({ media, index, view, onShow }: { media: AgentMedia[]; index: number; view: View; onShow: (key: string | null) => void }) {
	const { open } = useDashboardContext();
	const shown = media[index]!;
	const step = (by: 1 | -1): void => onShow(mediaKey(media[Math.min(media.length - 1, Math.max(0, index + by))]!));
	const agentView: View | null = view.kind === "live" && shown.agentId !== view.agentId ? { ...view, agentId: shown.agentId } : null;
	const caption = captionOf(shown);
	return (
		<DialogPrimitive.Root open onOpenChange={next => !next && onShow(null)}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden"
					onKeyDown={event => {
						if (event.key === "ArrowLeft") step(-1);
						else if (event.key === "ArrowRight") step(1);
					}}
				>
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 space-y-0.5">
							<Tooltip content={caption} side="bottom">
								<DialogPrimitive.Title className="truncate text-sm font-semibold">
									{caption}
								</DialogPrimitive.Title>
							</Tooltip>
							<DialogPrimitive.Description className="text-xs text-muted-foreground">
								{index + 1} of {media.length} · {new Date(shown.at).toLocaleString()}
							</DialogPrimitive.Description>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{agentView && (
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
							)}
							<Tooltip content="Open the image in a new tab">
								<Button variant="ghost" size="icon-compact" aria-label="Open the image in a new tab" asChild>
									<a href={shown.src} target="_blank" rel="noopener noreferrer">
										<ExternalLink />
									</a>
								</Button>
							</Tooltip>
							<Tooltip content="Close" shortcut={["Esc"]}>
								<DialogPrimitive.Close asChild>
									<Button variant="ghost" size="icon-compact" aria-label="Close">
										<X />
									</Button>
								</DialogPrimitive.Close>
							</Tooltip>
						</div>
					</div>
					<div className="flex min-h-0 flex-1 items-center gap-2">
						<Tooltip content="Newer image" shortcut={["←"]} disabled={index === 0}>
							<Button variant="ghost" size="icon-compact" aria-label="Newer image" disabled={index === 0} onClick={() => step(-1)}>
								<ChevronLeft />
							</Button>
						</Tooltip>
						<img src={shown.src} alt={caption} className="min-h-0 min-w-0 flex-1 max-h-[calc(100vh-9rem)] object-contain" />
						<Tooltip content="Older image" shortcut={["→"]} disabled={index === media.length - 1}>
							<Button variant="ghost" size="icon-compact" aria-label="Older image" disabled={index === media.length - 1} onClick={() => step(1)}>
								<ChevronRight />
							</Button>
						</Tooltip>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** The images the view's agent and its subagents' tools returned, newest first, as thumbnails that open large. */
export function MediaTab({ media, view }: { media: AgentMedia[] | null; view: View }) {
	const [selected, setSelected] = useState<string | null>(null);
	if (!media) return null;
	if (media.length === 0) return <p className="px-4 py-2 text-sm text-muted-foreground">No screenshots or images yet.</p>;
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
