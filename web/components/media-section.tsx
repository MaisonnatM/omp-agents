/** The Todos card's Images section: a strip of the view's images, their viewer, and the bar that sends the selected ones on. */
import { ChevronDown, GitPullRequest, type LucideIcon, MessageSquare, Paperclip } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import { type LinkedPullRequest, type PullRequestDetail, pullRequestName } from "../../src/shared/github";
import type { View } from "../../src/shared/sessions";
import { type AgentMedia, mediaExtension, mediaUrl } from "../../src/shared/transcript";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "../../src/json";
import { activityControl } from "../activity";
import { apiFetch, mediaSrc, putJson } from "../api";
import { age } from "../labels";
import { useRead } from "../reads";
import { useAction } from "../use-action";
import { useDashboardActions } from "./dashboard-context";
import { ImageViewer } from "./media-viewer";
import { fileBase64 } from "./prompt-attachments";
import { toasts } from "./toaster";

const agentName = (media: AgentMedia): string => media.agentId ?? "Main agent";

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Who took the image, with which tool, its file's name, and what the call said it did. */
const captionOf = (media: AgentMedia): string =>
	[agentName(media), media.tool, media.path && fileName(media.path), media.summary !== media.path && media.summary].filter(Boolean).join(" · ");

/** Names one image across updates: a new one arrives at the top, so its place in the list does not name it. */
const mediaKey = (media: AgentMedia): string => `${media.agentId}:${media.at}:${media.src}`;

const images = (count: number): string => (count === 1 ? "1 image" : `${count} images`);

/** Its file's bytes when it has one that still loads, since a `read` returns a re-encoded copy; else the image as shown. */
async function imageBlob(media: AgentMedia): Promise<Blob> {
	if (media.path && media.src !== mediaUrl(media.path)) {
		const original = await apiFetch(mediaUrl(media.path)).catch(() => null);
		if (original?.ok) return original.blob();
	}
	const response = await apiFetch(media.src);
	if (!response.ok) throw new Error(`The image did not load (HTTP ${response.status})`);
	return response.blob();
}

/** One image as a file to send: its bytes, its file's name or else one from its place in the batch and its type, and its alt text. */
async function imageFile(media: AgentMedia, place: number): Promise<{ name: string; type: string; data: string; alt: string }> {
	const blob = await imageBlob(media);
	const extension = mediaExtension(blob.type);
	const name = media.path ? fileName(media.path) : extension ? `image-${place}.${extension}` : `image-${place}`;
	return { name, type: blob.type, data: await fileBase64(blob), alt: media.path ? name : media.summary || name };
}

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

/** A pull request in the menu, by number and the title GitHub gives it once read. */
function PullRequestItem({ pr, onPick }: { pr: LinkedPullRequest; onPick: () => void }) {
	const title = useRead<Pick<PullRequestDetail, "title">>(`/api/pull-request/title?${new URLSearchParams({ owner: pr.owner, repo: pr.repo, number: String(pr.number) })}`);
	return (
		<MenuItem onClick={onPick} title={pullRequestName(pr)}>
			<GitPullRequest />
			<span className="min-w-0 flex-1 truncate">
				#{pr.number} {title.data?.title}
			</span>
		</MenuItem>
	);
}

interface MediaActionsProps {
	/** The selected images, in the order they were selected. */
	picked: AgentMedia[];
	pullRequests: LinkedPullRequest[];
	tickets: string[];
	/** The images to keep selected after a send: none when every one went, else the ones that did not. */
	onSent: (left: AgentMedia[]) => void;
	onClear: () => void;
}

interface TargetMenuProps {
	label: string;
	icon: LucideIcon;
	/** Why the menu has nothing to offer, shown on its disabled button; `null` when it has targets. */
	none: string | null;
	loading: boolean;
	disabled: boolean;
	/** The Activity control a click on the menu's button records. */
	control: ControlId;
	children: ReactNode;
}

/** A button that opens a menu of targets, or a disabled one that says why there are none. */
function TargetMenu({ label, icon, none, loading, disabled, control, children }: TargetMenuProps) {
	if (none !== null) {
		return (
			<Tooltip content={none} disabled>
				<Button variant="secondary" size="compact" leadingIcon={icon} disabled>
					{label}
				</Button>
			</Tooltip>
		);
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger {...activityControl(control)} render={<Button variant="secondary" size="compact" leadingIcon={icon} trailingIcon={ChevronDown} loading={loading} disabled={disabled} />}>{label}</DropdownMenuTrigger>
			<DropdownMenuContent align="end">{children}</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** What the selected images can go to: a pull request's description, through `gh pr edit --attach`, or a Linear issue's attachments. */
function MediaActions({ picked, pullRequests, tickets, onSent, onClear }: MediaActionsProps) {
	const toPullRequest = useAction(async (pr: LinkedPullRequest) => {
		const files = await Promise.all(picked.map((media, index) => imageFile(media, index + 1)));
		await putJson<object>("/api/pull-request/attachment", { owner: pr.owner, repo: pr.repo, number: pr.number, files });
		toasts.add({ title: `Added ${images(picked.length)} to ${pullRequestName(pr)}` });
		onSent([]);
	}, "Could not add the images to the pull request");
	const toTicket = useAction(async (issue: string) => {
		const refused: { media: AgentMedia; reason: string }[] = [];
		for (const [index, media] of picked.entries()) {
			try {
				const { name, type, data } = await imageFile(media, index + 1);
				await putJson<object>("/api/ticket/attachment", { issue, name, type: type || "application/octet-stream", data });
			} catch (err) {
				refused.push({ media, reason: `${media.path ? fileName(media.path) : `image ${index + 1}`} (${errorText(err)})` });
			}
		}
		const reasons = refused.map(({ reason }) => reason).join(", ");
		if (refused.length === picked.length) throw new Error(reasons);
		onSent(refused.map(({ media }) => media));
		const sent = picked.length - refused.length;
		toasts.add(
			refused.length === 0
				? { title: `Attached ${images(sent)} to ${issue}` }
				: { title: `Attached ${sent} of ${images(picked.length)} to ${issue}`, description: `Linear did not take ${reasons}. Those stay selected.` },
		);
	}, "Could not attach the images to the Linear issue");
	const pending = toPullRequest.pending || toTicket.pending;
	return (
		<div className="flex flex-wrap items-center gap-1 px-2 pt-1">
			<span className="mr-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
				{picked.length} selected
			</span>
			<TargetMenu label="Add to PR description" icon={GitPullRequest} none={pullRequests.length === 0 ? "This session has no pull request yet" : null} loading={toPullRequest.pending} disabled={pending} control="changes-card.image.to-pull-request">
				{pullRequests.map(pr => (
					<PullRequestItem key={pullRequestName(pr)} pr={pr} onPick={() => toPullRequest.run(pr)} />
				))}
			</TargetMenu>
			<TargetMenu label="Attach to Linear issue" icon={Paperclip} none={tickets.length === 0 ? "This session has no Linear issue yet" : null} loading={toTicket.pending} disabled={pending} control="changes-card.image.to-ticket">
				{tickets.map(issue => (
					<MenuItem key={issue} onClick={() => toTicket.run(issue)}>
						{issue}
					</MenuItem>
				))}
			</TargetMenu>
			<Button {...activityControl("changes-card.image.clear")} variant="ghost" size="compact" disabled={pending} onClick={onClear}>
				Clear
			</Button>
		</div>
	);
}

interface MediaStripProps {
	media: AgentMedia[];
	view: View;
	/** What the session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents worked on, by identifier, the session's own first. */
	tickets: string[];
}

/**
 * The images the view's agent and its subagents' tools returned or wrote, newest first, as a row of thumbnails that open
 * large. Selected ones go to one of the session's pull requests' descriptions or to one of its Linear issues; while any
 * is selected, a click selects instead of opening.
 */
export function MediaStrip({ media, view, pullRequests, tickets }: MediaStripProps) {
	const [shown, setShown] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const index = shown === null ? -1 : media.findIndex(item => mediaKey(item) === shown);
	const byKey = new Map(media.map(item => [mediaKey(item), item]));
	const picked = selected.flatMap(key => byKey.get(key) ?? []);
	const toggle = (key: string): void => setSelected(keys => (keys.includes(key) ? keys.filter(other => other !== key) : [...keys, key]));
	return (
		<>
			{picked.length > 0 && (
				<MediaActions picked={picked} pullRequests={pullRequests} tickets={tickets} onSent={left => setSelected(left.map(mediaKey))} onClear={() => setSelected([])} />
			)}
			<ul className="flex gap-1.5 overflow-x-auto px-2 py-1.5" aria-label="Images, newest first">
				{media.map(item => {
					const key = mediaKey(item);
					const checked = selected.includes(key);
					return (
						<li key={key} className="group relative shrink-0">
							<Tooltip
								content={
									<>
										{captionOf(item)} · {age(item.at)} ago
										{item.path && <span className="block font-mono break-all">{item.path}</span>}
									</>
								}
							>
								<button
									{...activityControl(picked.length > 0 ? "changes-card.image.select" : "media-viewer.open")}
									type="button"
									onClick={() => (picked.length > 0 ? toggle(key) : setShown(key))}
									aria-pressed={picked.length > 0 ? checked : undefined}
									className="block rounded-md p-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:ring-2 aria-pressed:ring-ring"
								>
									<img src={mediaSrc(item.src)} alt={item.summary || `Image from ${agentName(item)}`} loading="lazy" className="h-14 w-24 rounded-sm border border-border bg-muted object-cover object-top" />
								</button>
							</Tooltip>
							<input
								{...activityControl("changes-card.image.select")}
								type="checkbox"
								checked={checked}
								onChange={() => toggle(key)}
								aria-label={`Select ${captionOf(item)}`}
								className={`absolute top-1.5 left-1.5 size-3.5 accent-current group-focus-within:opacity-100 group-hover:opacity-100 ${picked.length > 0 ? "opacity-100" : "opacity-0"}`}
							/>
						</li>
					);
				})}
			</ul>
			{index >= 0 && <MediaViewer media={media} index={index} view={view} onShow={setShown} />}
		</>
	);
}
