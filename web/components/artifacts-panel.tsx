/**
 * `ArtifactsPanel`, the right sidebar's **Artifacts** tab: a tab per artifact once there are two, the shown version's
 * title, file, and actions, its numbered versions with the shown one's note, and the version itself, rendered or as source.
 */
import { Code, Download, ExternalLink, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { SizeProvider } from "@/lib/size-context";
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

/** An action that keeps only its icon is the app's 28px square icon button. */
const ICON_SQUARE = "@max-[30rem]/artifacts:w-7 @max-[30rem]/artifacts:px-0";

/** Download and Open in browser are links, which take no `disabled`: with no address they look and act as a disabled button does. */
const LINK_ACTION = cn(ICON_SQUARE, "aria-disabled:pointer-events-none aria-disabled:opacity-50");

/** On a touch screen a small control also takes taps up to 8px above and below it. */
const TALLER_TAP = "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2";

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
		<Tabs value={artifact.file} onValueChange={file => pickArtifact(view, { file, version: "latest" })} className="@container/artifacts flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 border-b border-border px-4 py-2">
				<SizeProvider size="compact">
					<TabsList aria-label="Artifacts" className="flex-wrap">
						{artifacts.map(each => (
							<TabItem {...activityControl("artifacts.artifact")} key={each.file} value={each.file} icon={ARTIFACT_KIND[each.kind].icon} label={each.title} />
						))}
					</TabsList>
				</SizeProvider>
			</div>
			<TabPanel value={artifact.file} className="flex min-h-0 flex-1 flex-col">
				{body}
			</TabPanel>
		</Tabs>
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
	// Read here so Copy finds the text in the cache; a version whose saved copy is gone still gets an address, which answers 404, so its actions stay off.
	const gone = useArtifactText(link.state === "ready" ? link.value : null).state === "failed";
	const url = link.state === "ready" && !gone ? link.value : null;
	const kind = ARTIFACT_KIND[artifact.kind];
	const latest = artifact.versions.at(-1)!;
	const name = artifact.file.split("/").at(-1)!;
	const pick = (picked: ArtifactVersion) => pickArtifact(view, { file: artifact.file, version: picked === latest ? "latest" : picked.number });
	return (
		<SegmentedTabs value={source ? "source" : "rendered"} onValueChange={value => onSource(value === "source")} className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-4 pt-3.5 pb-3">
				<div className="flex items-start gap-3">
					<h3 className="min-w-0 flex-1 text-[16px] leading-7 font-semibold tracking-tight [overflow-wrap:anywhere]">{artifact.title}</h3>
					<div className="flex shrink-0 items-center gap-1.5">
						<CopyAction url={url} />
						<Tooltip content="Download">
							<Button {...activityControl("artifacts.download")} asChild variant="tertiary" size="compact" leadingIcon={Download} className={LINK_ACTION}>
								<a href={url ?? undefined} download={name} aria-disabled={url === null || undefined}>
									<span className={ICONS_ONLY}>Download</span>
								</a>
							</Button>
						</Tooltip>
						<Tooltip content="Open in browser">
							<Button {...activityControl("artifacts.open-in-browser")} asChild variant="tertiary" size="compact" leadingIcon={ExternalLink} className={LINK_ACTION}>
								<a href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={url === null || undefined}>
									<span className={ICONS_ONLY}>Open in browser</span>
								</a>
							</Button>
						</Tooltip>
					</div>
				</div>
				<p className="text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
					<span className="font-mono">{artifact.file}</span>
					{"\u00a0· "}
					<span className="whitespace-nowrap">
						{kind.label} · {formatBytes(save.bytes)} ·
					</span>{" "}
					<time dateTime={new Date(save.savedAt).toISOString()} title={new Date(save.savedAt).toLocaleString()} className="whitespace-nowrap">
						saved {mailTime(save.savedAt)}
					</time>
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
					<span className="text-xs text-muted-foreground">Version</span>
					{/* Its own tabs, which switch no panel and so name none: the arrow keys move between versions and Enter shows one, so passing one loads nothing. */}
					<SegmentedTabs value={String(version.number)} onValueChange={value => pick(artifact.versions.find(each => String(each.number) === value)!)} activationMode="manual">
						<SegmentedTabsList variant="pills" aria-label="Versions">
							{artifact.versions.map(each => (
								<Tooltip key={each.number} content={`Version ${each.number}${each.save.note ? ` · ${each.save.note}` : ""} · saved ${mailTime(each.save.savedAt)}`}>
									<SegmentedTab
										{...activityControl("artifacts.version")}
										value={String(each.number)}
										variant="pills"
										aria-label={`Version ${each.number}`}
										aria-controls={undefined}
										className={TALLER_TAP}
									>
										{each.number}
									</SegmentedTab>
								</Tooltip>
							))}
						</SegmentedTabsList>
					</SegmentedTabs>
					{(save.note || version !== latest) && (
						<p className="min-w-0 flex-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere] @max-[32rem]/artifacts:order-last @max-[32rem]/artifacts:basis-full">
							{save.note}
							{save.note && version !== latest && " · "}
							{version !== latest && (
								<button
									{...activityControl("artifacts.latest")}
									type="button"
									onClick={() => pick(latest)}
									className={cn("rounded-sm whitespace-nowrap text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring", TALLER_TAP)}
								>
									Go to latest
								</button>
							)}
						</p>
					)}
					<SegmentedTabsList aria-label="Show as" className="ml-auto">
						<Tooltip content="Rendered">
							<SegmentedTab {...activityControl("artifacts.rendered")} value="rendered" className="gap-1 px-2">
								<Eye aria-hidden className="size-3.5" />
								<span className={ICONS_ONLY}>Rendered</span>
							</SegmentedTab>
						</Tooltip>
						<Tooltip content="Source">
							<SegmentedTab {...activityControl("artifacts.source")} value="source" className="gap-1 px-2">
								<Code aria-hidden className="size-3.5" />
								<span className={ICONS_ONLY}>Source</span>
							</SegmentedTab>
						</Tooltip>
					</SegmentedTabsList>
				</div>
			</div>
			<SegmentedTabPanel value={source ? "source" : "rendered"} className="flex min-h-0 flex-1 flex-col px-4 pb-4 outline-none">
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background shadow-surface-3">
					<ArtifactView link={link} kind={artifact.kind} file={artifact.file} title={artifact.title} source={source} />
				</div>
			</SegmentedTabPanel>
		</SegmentedTabs>
	);
}

/** Copies the version's text, which the panel has read already, so the copy lands while the click still counts as the user's. */
function CopyAction({ url }: { url: string | null }) {
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
				className={ICON_SQUARE}
			>
				<span className={ICONS_ONLY}>{copied ? "Copied" : "Copy"}</span>
			</Button>
		</Tooltip>
	);
}
