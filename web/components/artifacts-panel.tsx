/**
 * `ArtifactsPanel`, the right sidebar's **Artifacts** tab: a tab per artifact once there are two, the shown version's
 * title, file, and actions, its numbered versions with the shown one's note, and the version itself, rendered or as source.
 */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Code, Download, ExternalLink, Eye } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { useArtifactVersion } from "../artifact-links";
import { pickArtifact, showArtifact, useArtifactPick } from "../artifact-requests";
import { type Artifact, type ArtifactVersion, pickedVersion } from "../artifacts-model";
import { formatBytes, mailTime } from "../labels";
import { useCopy } from "../use-copy";
import { ARTIFACT_KIND, ArtifactView } from "./artifact-view";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "./segmented-tabs";
import { SidebarOpen } from "./sidebar-panel";

/** Under this panel width the Rendered and Source switch keeps only its icons. */
const ICONS_ONLY = "@max-[30rem]/artifacts:sr-only";

/** The pull request header's action recipe: under this panel width an action keeps only its icon, and its `aria-label` names it. */
const ACTION_LABEL = "@max-[30rem]/artifacts:hidden";
const ACTION_BUTTON = "shrink-0 font-medium @max-[30rem]/artifacts:gap-0 @max-[30rem]/artifacts:px-1.5";

/** Download and Open in browser are links, which take no `disabled`: with no address they look and act as a disabled button does. */
const LINK_ACTION = cn(ACTION_BUTTON, "aria-disabled:pointer-events-none aria-disabled:opacity-50");

/** On a touch screen a small control also takes taps up to 8px above and below it. */
const TALLER_TAP = "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2";

/** A version number: the size of a segmented tab, and the chosen one filled in the text's colour. */
const VERSION_PILL = cn(
	"inline-flex h-6 min-w-6 shrink-0 cursor-pointer select-none items-center justify-center rounded-md border border-transparent px-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors",
	"not-data-[checked]:hover:bg-background/55 not-data-[checked]:hover:text-foreground dark:not-data-[checked]:hover:bg-input/32 data-[checked]:bg-foreground data-[checked]:text-background",
	"focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
	TALLER_TAP,
);

interface ArtifactsPanelProps {
	view: View;
	/** The session whose artifacts these are, which their addresses name. */
	sessionId: string;
	/** Never empty: the tab shows once the view has an artifact. */
	artifacts: Artifact[];
}

export function ArtifactsPanel({ view, sessionId, artifacts }: ArtifactsPanelProps) {
	const picked = pickedVersion(artifacts, useArtifactPick(view))!;
	const { artifact, version } = picked;
	const [source, setSource] = useState(false);
	// A card reads Showing only while its version is in sight.
	const open = useContext(SidebarOpen);
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
	const loaded = useArtifactVersion(sessionId, save);
	// A version whose saved copy is gone still gets an address, which answers 404, so its actions wait for the text.
	const ready = loaded.state === "ready" ? loaded.value : null;
	const url = ready?.url ?? null;
	const kind = ARTIFACT_KIND[artifact.kind];
	const latest = artifact.versions.at(-1)!;
	const name = artifact.file.split("/").at(-1)!;
	const pick = (picked: ArtifactVersion) => pickArtifact(view, { file: artifact.file, version: picked === latest ? "latest" : picked.number });
	return (
		<SegmentedTabs value={source ? "source" : "rendered"} onValueChange={value => onSource(value === "source")} className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-4 pt-3.5 pb-3">
				<div className="flex items-start gap-3">
					<h3 className="min-w-0 flex-1 text-base leading-7 font-semibold tracking-tight [overflow-wrap:anywhere]">{artifact.title}</h3>
					<div className="flex h-7 shrink-0 items-center gap-1">
						<CopyAction text={ready?.text ?? null} />
						<Tooltip content="Download">
							<Button {...activityControl("artifacts.download")} asChild variant="outline" size="xs" leadingIcon={Download} aria-label="Download" className={LINK_ACTION}>
								<a href={url ?? undefined} download={name} aria-disabled={url === null || undefined}>
									<span className={ACTION_LABEL}>Download</span>
								</a>
							</Button>
						</Tooltip>
						<Tooltip content="Open in browser">
							<Button {...activityControl("artifacts.open-in-browser")} asChild variant="outline" size="xs" leadingIcon={ExternalLink} aria-label="Open in browser" className={LINK_ACTION}>
								<a href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={url === null || undefined}>
									<span className={ACTION_LABEL}>Open in browser</span>
								</a>
							</Button>
						</Tooltip>
					</div>
				</div>
				<p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
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
					<RadioGroup aria-label="Versions" value={version.number} onValueChange={number => pick(artifact.versions.find(each => each.number === number)!)} className="flex w-fit shrink-0 flex-wrap gap-0.5">
						{artifact.versions.map(each => (
							<Tooltip key={each.number} content={`Version ${each.number}${each.save.note ? ` · ${each.save.note}` : ""} · saved ${mailTime(each.save.savedAt)}`}>
								<Radio.Root {...activityControl("artifacts.version")} value={each.number} aria-label={`Version ${each.number}`} className={VERSION_PILL}>
									{each.number}
								</Radio.Root>
							</Tooltip>
						))}
					</RadioGroup>
					{(save.note || version !== latest) && (
						<p className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere] @max-[32rem]/artifacts:order-last @max-[32rem]/artifacts:basis-full">
							{save.note}
							{save.note && version !== latest && " · "}
							{version !== latest && (
								<button
									{...activityControl("artifacts.latest")}
									type="button"
									onClick={() => pick(latest)}
									className={cn("rounded-sm whitespace-nowrap text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring dark:text-blue-400", TALLER_TAP)}
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
					<ArtifactView loaded={loaded} kind={artifact.kind} file={artifact.file} title={artifact.title} source={source} />
				</div>
			</SegmentedTabPanel>
		</SegmentedTabs>
	);
}

/** Copies the version's text, read already for the view, so the copy lands while the click still counts as the user's. */
function CopyAction({ text }: { text: string | null }) {
	const { copied, copy } = useCopy();
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	return (
		<Tooltip content={copied ? "Copied" : "Copy"}>
			<Button
				{...activityControl("artifacts.copy")}
				variant="outline"
				size="xs"
				leadingIcon={copied ? CheckIcon : CopyIcon}
				disabled={text === null}
				onClick={() => text !== null && copy(text)}
				aria-label={copied ? "Copied" : "Copy"}
				className={ACTION_BUTTON}
			>
				<span className={ACTION_LABEL}>{copied ? "Copied" : "Copy"}</span>
			</Button>
		</Tooltip>
	);
}
