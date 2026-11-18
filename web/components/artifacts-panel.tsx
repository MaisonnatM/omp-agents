/**
 * `ArtifactsPanel`, the right sidebar's **Artifacts** tab: a toolbar with the artifact's title, which picks another
 * artifact once there are two, the Preview and Source switch a drawn code block in a reply also has, and the actions;
 * the version full-bleed; and a version bar that steps through the versions and shows the shown one's note.
 */
import { IconArrowInbox, IconChevronDownSmall, IconChevronLeftSmall, IconChevronRightSmall, IconCode, IconEyeOpen, IconSquareArrowTopRight } from "central-icons";
import { useContext, useEffect, useState } from "react";
import type { View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useIcon } from "@/lib/icon-context";
import { activityControl } from "../activity";
import { useArtifactVersion } from "../artifact-links";
import { pickArtifact, showArtifact, useArtifactPick } from "../artifact-requests";
import { type Artifact, type ArtifactVersion, pickedVersion } from "../artifacts-model";
import { formatBytes, listTime } from "../labels";
import { useCopy } from "../use-copy";
import { ARTIFACT_KIND, ArtifactView } from "./artifact-view";
import { SegmentedTab, SegmentedTabPanel, SegmentedTabs, SegmentedTabsList } from "./segmented-tabs";
import { SidebarOpen } from "./sidebar-panel";

/** Under this panel width the Preview and Source switch keeps only its icons, and the version bar drops the size and save time. */
const NARROW_HIDDEN = "@max-[30rem]/artifacts:hidden";
/** Under the same width a label stays only for screen readers, so the Preview and Source tabs keep their names. */
const NARROW_SR_ONLY = "@max-[30rem]/artifacts:sr-only";

/** Download and Open in browser are links, which take no `disabled`: with no address they look and act as a disabled button does. */
const LINK_ACTION = "aria-disabled:pointer-events-none aria-disabled:opacity-50";

interface ArtifactsPanelProps {
	view: View;
	/** The session whose artifacts these are, which their addresses name. */
	sessionId: string;
	/** Never empty: the tab shows once the view has an artifact. */
	artifacts: Artifact[];
}

export function ArtifactsPanel({ view, sessionId, artifacts }: ArtifactsPanelProps) {
	const { artifact, version } = pickedVersion(artifacts, useArtifactPick(view))!;
	const [source, setSource] = useState(false);
	// A card reads Showing only while its version is in sight.
	const open = useContext(SidebarOpen);
	useEffect(() => {
		if (!open) return;
		showArtifact(view, { file: artifact.file, number: version.number });
		return () => showArtifact(view, null);
	}, [view, open, artifact.file, version.number]);
	const { save } = version;
	const loaded = useArtifactVersion(sessionId, save);
	// A version whose saved copy is gone still gets an address, which answers 404, so its actions wait for the text.
	const ready = loaded.state === "ready" ? loaded.value : null;
	const url = ready?.url ?? null;
	const name = artifact.file.split("/").at(-1)!;
	const pick = (number: number) => pickArtifact(view, { file: artifact.file, version: number === artifact.versions.at(-1)!.number ? "latest" : number });
	return (
		<SegmentedTabs value={source ? "source" : "rendered"} onValueChange={value => setSource(value === "source")} className="@container/artifacts flex min-h-0 flex-1 flex-col bg-background">
			{/* In a narrow panel, such as the sidebar at its default width, the title takes a row of its own above the controls, as the Browser's address takes one below its buttons. */}
			<div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-border px-1.5 @max-[24rem]/artifacts:py-1">
				<div className="flex min-w-0 flex-1 @max-[24rem]/artifacts:basis-full">
					<ArtifactTitle view={view} artifacts={artifacts} artifact={artifact} />
				</div>
				<SegmentedTabsList aria-label="Show as">
					<Tooltip content="Preview" side="bottom">
						<SegmentedTab {...activityControl("artifacts.rendered")} value="rendered" className="gap-1 px-2">
							<IconEyeOpen className="size-3.5" />
							<span className={NARROW_SR_ONLY}>Preview</span>
						</SegmentedTab>
					</Tooltip>
					<Tooltip content="Source" side="bottom">
						<SegmentedTab {...activityControl("artifacts.source")} value="source" className="gap-1 px-2">
							<IconCode className="size-3.5" />
							<span className={NARROW_SR_ONLY}>Source</span>
						</SegmentedTab>
					</Tooltip>
				</SegmentedTabsList>
				<span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border @max-[24rem]/artifacts:ml-auto" />
				<CopyAction text={ready?.text ?? null} />
				<Tooltip content="Download" side="bottom">
					<Button {...activityControl("artifacts.download")} asChild variant="ghost" size="icon-compact" aria-label="Download" className={LINK_ACTION}>
						<a href={url ?? undefined} download={name} aria-disabled={url === null || undefined}>
							<IconArrowInbox />
						</a>
					</Button>
				</Tooltip>
				<Tooltip content="Open in browser" side="bottom">
					<Button {...activityControl("artifacts.open-in-browser")} asChild variant="ghost" size="icon-compact" aria-label="Open in browser" className={LINK_ACTION}>
						<a href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={url === null || undefined}>
							<IconSquareArrowTopRight />
						</a>
					</Button>
				</Tooltip>
			</div>
			<SegmentedTabPanel value={source ? "source" : "rendered"} className="flex min-h-0 flex-1 flex-col outline-none">
				<ArtifactView loaded={loaded} kind={artifact.kind} file={artifact.file} title={artifact.title} source={source} />
			</SegmentedTabPanel>
			<VersionBar artifact={artifact} version={version} onPick={pick} />
		</SegmentedTabs>
	);
}

/** The shown artifact's kind icon and title; with two artifacts or more, a menu that picks another, each at its latest version. */
function ArtifactTitle({ view, artifacts, artifact }: { view: View; artifacts: Artifact[]; artifact: Artifact }) {
	const Icon = ARTIFACT_KIND[artifact.kind].icon;
	if (artifacts.length === 1) {
		return (
			<h3 title={artifact.file} className="flex min-w-0 items-center gap-1.5 px-1.5 text-sm font-medium">
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="truncate">{artifact.title}</span>
			</h3>
		);
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				{...activityControl("artifacts.artifact")}
				render={<Button variant="ghost" size="compact" leadingIcon={Icon} trailingIcon={IconChevronDownSmall} aria-label={`${artifact.title}, one of ${artifacts.length} artifacts`} className="min-w-0 font-medium text-foreground" />}
			>
				{artifact.title}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-96">
				<MenuRadioGroup aria-label="Artifacts" value={artifact.file} onValueChange={(file: string) => pickArtifact(view, { file, version: "latest" })}>
					{artifacts.map(each => {
						const EachIcon = ARTIFACT_KIND[each.kind].icon;
						return (
							<MenuRadioItem key={each.file} value={each.file} title={each.file} closeOnClick>
								<EachIcon />
								<span className="min-w-0 flex-1 truncate">{each.title}</span>
								{each.versions.length > 1 && <span className="pl-3 text-xs text-muted-foreground tabular-nums">v{each.versions.length}</span>}
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Older and newer arrows around a menu of every version, then the shown one's note, and its kind, size, and save time or a way back to the latest. */
export function VersionBar({ artifact, version, onPick }: { artifact: Artifact; version: ArtifactVersion; onPick: (number: number) => void }) {
	const { save } = version;
	const count = artifact.versions.length;
	const latest = version.number === count;
	return (
		<div className="flex min-h-9 shrink-0 items-center gap-1 border-t border-border px-1.5 text-xs text-muted-foreground">
			{count > 1 ? (
				<>
					<Tooltip content="Older version" side="top" disabled={version.number === 1}>
						<Button {...activityControl("artifacts.version")} variant="ghost" size="icon-xs" aria-label="Older version" disabled={version.number === 1} onClick={() => onPick(version.number - 1)}>
							<IconChevronLeftSmall />
						</Button>
					</Tooltip>
					<DropdownMenu>
						<DropdownMenuTrigger
							{...activityControl("artifacts.version")}
							render={<Button variant="ghost" size="xs" trailingIcon={IconChevronDownSmall} aria-label={`Version ${version.number} of ${count}`} className="shrink-0 tabular-nums" />}
						>
							Version {version.number} of {count}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" side="top" className="max-w-96">
							<MenuRadioGroup aria-label="Versions" value={version.number} onValueChange={(number: number) => onPick(number)}>
								{artifact.versions.toReversed().map(each => (
									<MenuRadioItem key={each.number} value={each.number} closeOnClick>
										<span className="w-6 shrink-0 tabular-nums text-muted-foreground">v{each.number}</span>
										<span className="min-w-0 flex-1 truncate">{each.save.note ?? (each.number === 1 ? "First version" : "No note")}</span>
										<span className="pl-3 text-xs whitespace-nowrap text-muted-foreground">{listTime(each.save.savedAt)}</span>
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Tooltip content="Newer version" side="top" disabled={latest}>
						<Button {...activityControl("artifacts.version")} variant="ghost" size="icon-xs" aria-label="Newer version" disabled={latest} onClick={() => onPick(version.number + 1)}>
							<IconChevronRightSmall />
						</Button>
					</Tooltip>
				</>
			) : (
				<span className="shrink-0 px-1.5">Version 1</span>
			)}
			<span title={save.note ?? undefined} className="min-w-0 flex-1 truncate px-1">
				{save.note}
			</span>
			{latest ? (
				<span className={`shrink-0 pr-1.5 whitespace-nowrap ${NARROW_HIDDEN}`}>
					{ARTIFACT_KIND[artifact.kind].label} · {formatBytes(save.bytes)} ·{" "}
					<time dateTime={new Date(save.savedAt).toISOString()} title={new Date(save.savedAt).toLocaleString()}>
						{listTime(save.savedAt)}
					</time>
				</span>
			) : (
				<Button {...activityControl("artifacts.latest")} variant="ghost" size="xs" onClick={() => onPick(count)} className="shrink-0 text-foreground">
					Go to latest
				</Button>
			)}
		</div>
	);
}

/** Copies the version's text, read already for the view, so the copy lands while the click still counts as the user's. */
function CopyAction({ text }: { text: string | null }) {
	const { copied, copy } = useCopy();
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	const label = copied ? "Copied" : "Copy";
	return (
		<Tooltip content={label} side="bottom">
			<Button {...activityControl("artifacts.copy")} variant="ghost" size="icon-compact" disabled={text === null} onClick={() => text !== null && copy(text)} aria-label={label}>
				{copied ? <CheckIcon /> : <CopyIcon />}
			</Button>
		</Tooltip>
	);
}
