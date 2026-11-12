/**
 * `ArtifactsPanel`, the right sidebar's **Artifacts** tab: a tab per artifact once there are two, the shown version's
 * title, file, and actions, its numbered versions with the shown one's note, and the version itself, rendered or as source.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Code, Download, ExternalLink, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { artifactText, useArtifactText, useArtifactUrl } from "../artifact-links";
import { pickArtifact, showArtifact, useArtifactPick } from "../artifact-requests";
import { type Artifact, type ArtifactVersion, pickedVersion } from "../artifacts-model";
import { formatBytes, mailTime } from "../labels";
import { useAction } from "../use-action";
import { useCopy } from "../use-copy";
import { ARTIFACT_KIND, ArtifactView } from "./artifact-view";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "./segmented-tabs";

/** Under this panel width the actions and the Rendered and Source switch keep only their icons. */
const ICONS_ONLY = "@max-[30rem]/artifacts:sr-only";

interface ArtifactsPanelProps {
	view: View;
	/** The session whose artifacts these are, which their addresses name. */
	sessionId: string;
	/** Never empty: the tab shows once the view has an artifact. */
	artifacts: Artifact[];
	/** Whether the right sidebar is open, so a card reads Showing only while its version is in sight. */
	open: boolean;
}

export function ArtifactsPanel({ view, sessionId, artifacts, open }: ArtifactsPanelProps) {
	const picked = pickedVersion(artifacts, useArtifactPick(view))!;
	const { artifact, version } = picked;
	const [source, setSource] = useState(false);
	useEffect(() => {
		if (!open) return;
		showArtifact(view, { file: artifact.file, number: version.number });
		return () => showArtifact(view, null);
	}, [view, open, artifact.file, version.number]);
	const body = <ArtifactBody view={view} sessionId={sessionId} artifact={artifact} version={version} source={source} onSource={setSource} />;
	if (artifacts.length === 1) return <div className="@container/artifacts flex min-h-0 flex-1 flex-col">{body}</div>;
	return (
		<TabsPrimitive.Root
			value={artifact.file}
			onValueChange={file => pickArtifact(view, { file, version: "latest" })}
			className="@container/artifacts flex min-h-0 flex-1 flex-col"
		>
			<TabsPrimitive.List aria-label="Artifacts" className="flex shrink-0 items-center gap-4 overflow-x-auto border-b border-border px-4 [scrollbar-width:none]">
				{artifacts.map(each => {
					const { icon: Icon } = ARTIFACT_KIND[each.kind];
					return (
						<TabsPrimitive.Trigger
							{...activityControl("artifacts.artifact")}
							key={each.file}
							value={each.file}
							className="relative flex h-10 max-w-48 shrink-0 items-center gap-1.5 px-1 text-[13px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-selected:text-foreground aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:-bottom-px aria-selected:after:h-0.5 aria-selected:after:rounded-full aria-selected:after:bg-foreground"
						>
							<Icon aria-hidden className="size-3.5 shrink-0" />
							<span className="truncate">{each.title}</span>
						</TabsPrimitive.Trigger>
					);
				})}
			</TabsPrimitive.List>
			<TabsPrimitive.Content value={artifact.file} className="flex min-h-0 flex-1 flex-col outline-none">
				{body}
			</TabsPrimitive.Content>
		</TabsPrimitive.Root>
	);
}

interface ArtifactBodyProps {
	view: View;
	sessionId: string;
	artifact: Artifact;
	version: ArtifactVersion;
	source: boolean;
	onSource: (source: boolean) => void;
}

function ArtifactBody({ view, sessionId, artifact, version, source, onSource }: ArtifactBodyProps) {
	const { save } = version;
	const link = useArtifactUrl(sessionId, save);
	const url = link.state === "ready" ? link.value : null;
	const kind = ARTIFACT_KIND[artifact.kind];
	const latest = artifact.versions.at(-1)!;
	const name = artifact.file.split("/").at(-1)!;
	const pick = (picked: ArtifactVersion) => pickArtifact(view, { file: artifact.file, version: picked === latest ? "latest" : picked.number });
	return (
		<SegmentedTabs value={source ? "source" : "rendered"} onValueChange={value => onSource(value === "source")} className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-4 pt-3.5 pb-3">
				<div className="flex items-start gap-3">
					<div className="min-w-0 flex-1">
						<h3 className="truncate text-[16px] font-semibold tracking-tight">{artifact.title}</h3>
						<p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
							<span className="font-mono">{artifact.file}</span>
							{"\u00a0· "}
							<span className="whitespace-nowrap">
								{kind.label} · {formatBytes(save.bytes)} ·
							</span>{" "}
							<time dateTime={new Date(save.savedAt).toISOString()} title={new Date(save.savedAt).toLocaleString()} className="whitespace-nowrap">
								saved {mailTime(save.savedAt)}
							</time>
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<CopyAction url={url} />
						<Tooltip content="Download">
							<Button {...activityControl("artifacts.download")} asChild variant="tertiary" size="compact" leadingIcon={Download} className="@max-[30rem]/artifacts:px-2">
								<a href={url ?? undefined} download={name} aria-disabled={url === null || undefined}>
									<span className={ICONS_ONLY}>Download</span>
								</a>
							</Button>
						</Tooltip>
						<Tooltip content="Open in browser">
							<Button {...activityControl("artifacts.open-in-browser")} asChild variant="tertiary" size="compact" leadingIcon={ExternalLink} className="@max-[30rem]/artifacts:px-2">
								<a href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={url === null || undefined}>
									<span className={ICONS_ONLY}>Open in browser</span>
								</a>
							</Button>
						</Tooltip>
					</div>
				</div>
				<div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
					<span className="text-[12px] text-muted-foreground">Version</span>
					<div role="group" aria-label="Versions" className="flex flex-wrap items-center gap-0.5">
						{artifact.versions.map(each => (
							<Tooltip key={each.number} content={`Version ${each.number}${each.save.note ? ` · ${each.save.note}` : ""} · saved ${mailTime(each.save.savedAt)}`}>
								<button
									{...activityControl("artifacts.version")}
									type="button"
									aria-pressed={each === version}
									aria-label={`Version ${each.number}`}
									onClick={() => pick(each)}
									className={cn(
										"h-6 min-w-6 rounded-md px-1.5 text-[12px] tabular-nums transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
										each === version ? "bg-foreground text-background" : "text-muted-foreground hover:bg-hover hover:text-foreground",
									)}
								>
									{each.number}
								</button>
							</Tooltip>
						))}
					</div>
					{(save.note || version !== latest) && (
						<p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground @max-[32rem]/artifacts:order-last @max-[32rem]/artifacts:basis-full">
							{save.note}
							{save.note && version !== latest && " · "}
							{version !== latest && (
								<button {...activityControl("artifacts.latest")} type="button" onClick={() => pick(latest)} className="text-primary hover:underline focus-visible:underline focus-visible:outline-none">
									Go to latest
								</button>
							)}
						</p>
					)}
					<SegmentedTabsList aria-label="Show as" className="ml-auto">
						<SegmentedTab {...activityControl("artifacts.rendered")} value="rendered" className="gap-1 px-2">
							<Eye aria-hidden className="size-3.5" />
							<span className={ICONS_ONLY}>Rendered</span>
						</SegmentedTab>
						<SegmentedTab {...activityControl("artifacts.source")} value="source" className="gap-1 px-2">
							<Code aria-hidden className="size-3.5" />
							<span className={ICONS_ONLY}>Source</span>
						</SegmentedTab>
					</SegmentedTabsList>
				</div>
			</div>
			<SegmentedTabPanel value={source ? "source" : "rendered"} className="flex min-h-0 flex-1 flex-col px-4 pb-4 outline-none">
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background shadow-surface-3">
					<ArtifactView link={link} kind={artifact.kind} title={artifact.title} source={source} />
				</div>
			</SegmentedTabPanel>
		</SegmentedTabs>
	);
}

/** Copies the version's text, read as the panel shows the version, so the copy lands while the click still counts as the user's. */
function CopyAction({ url }: { url: string | null }) {
	useArtifactText(url);
	const { copied, copy } = useCopy();
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	const copying = useAction(async (from: string) => copy(await artifactText(from)), "Could not copy");
	return (
		<Tooltip content={copied ? "Copied" : "Copy"}>
			<Button
				{...activityControl("artifacts.copy")}
				variant="tertiary"
				size="compact"
				leadingIcon={copied ? CheckIcon : CopyIcon}
				loading={copying.pending}
				disabled={url === null}
				onClick={() => url && copying.run(url)}
				className="@max-[30rem]/artifacts:px-2"
			>
				<span className={ICONS_ONLY}>{copied ? "Copied" : "Copy"}</span>
			</Button>
		</Tooltip>
	);
}
