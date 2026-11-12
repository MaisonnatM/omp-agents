/** A view's artifacts, read from the tool items that saved them: what the Artifacts tab lists and the transcript's cards number. */
import type { ArtifactKind, ArtifactSave } from "../src/shared/artifacts";
import type { Item } from "../src/shared/transcript";

/** A tool call that saved an artifact version. */
export type ArtifactToolItem = Extract<Item, { kind: "tool" }> & { artifact: ArtifactSave };

export const savedArtifact = (item: Item): item is ArtifactToolItem => item.kind === "tool" && item.artifact !== undefined;

/** One version of an artifact: the save that made it, the tool items that saved its bytes, and its number, counting from 1 in save order. */
export interface ArtifactVersion {
	save: ArtifactSave;
	/** The item that made the version, then each that saved equal bytes right after it, so every card finds its number. */
	itemIds: string[];
	number: number;
}

/** One file the agent saved, by its `file`, with the title and kind of its latest save. */
export interface Artifact {
	file: string;
	kind: ArtifactKind;
	title: string;
	versions: ArtifactVersion[];
}

/**
 * Which version the Artifacts tab shows: `"latest"` follows new saves, a number stays put. A number and not a hash, since
 * equal bytes saved again after a change make a later version with the same hash.
 */
export interface ArtifactPick {
	file: string;
	version: number | "latest";
}

/** The view's artifacts, most recently saved first, each with its versions in save order; a save equal to the one before it adds no version. */
export function artifactsOf(items: readonly Item[]): Artifact[] {
	const byFile = new Map<string, { artifact: Artifact; last: number }>();
	items.forEach((item, at) => {
		if (!savedArtifact(item)) return;
		const save = item.artifact;
		const entry = byFile.get(save.file);
		if (!entry) {
			byFile.set(save.file, { artifact: { file: save.file, kind: save.kind, title: save.title, versions: [{ save, itemIds: [item.id], number: 1 }] }, last: at });
			return;
		}
		const { artifact } = entry;
		entry.last = at;
		artifact.title = save.title;
		artifact.kind = save.kind;
		const latest = artifact.versions.at(-1)!;
		if (latest.save.sha256 === save.sha256) latest.itemIds.push(item.id);
		else artifact.versions.push({ save, itemIds: [item.id], number: latest.number + 1 });
	});
	return [...byFile.values()].sort((a, b) => b.last - a.last).map(entry => entry.artifact);
}

/** The number of the version a saving item made, or repeated when its bytes equal the version before; `artifacts` must be built from a list holding `item`. */
export const versionNumber = (artifacts: readonly Artifact[], item: ArtifactToolItem): number =>
	artifacts.find(artifact => artifact.file === item.artifact.file)!.versions.find(version => version.itemIds.includes(item.id))!.number;

/** The version a pick shows, falling back to the picked artifact's latest, and to the newest artifact's latest when the pick names no artifact present. */
export function pickedVersion(artifacts: readonly Artifact[], pick: ArtifactPick | null): { artifact: Artifact; version: ArtifactVersion } | null {
	const artifact = (pick && artifacts.find(each => each.file === pick.file)) || artifacts[0];
	if (!artifact) return null;
	const latest = artifact.versions.at(-1)!;
	const number = pick?.file === artifact.file ? pick.version : "latest";
	return { artifact, version: number === "latest" ? latest : (artifact.versions.find(version => version.number === number) ?? latest) };
}

/** The saves a delta lands: items that now carry `artifact` and did not before, such as a call turning from running to done; a reset lands none. */
export function landedSaves(before: readonly Item[], msg: { reset: boolean; items: readonly Item[] }): ArtifactSave[] {
	if (msg.reset) return [];
	return msg.items.flatMap(item => {
		if (!savedArtifact(item)) return [];
		const was = before.findLast(old => old.id === item.id);
		return was && savedArtifact(was) ? [] : [item.artifact];
	});
}
