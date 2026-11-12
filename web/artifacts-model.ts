/** A view's artifacts, read from the tool items that saved them: what the Artifacts tab lists and the transcript's cards number. */
import type { ArtifactKind, ArtifactSave } from "../src/shared/artifacts";
import type { Item } from "../src/shared/transcript";

/** A tool call that saved an artifact version. */
export type ArtifactToolItem = Extract<Item, { kind: "tool" }> & { artifact: ArtifactSave };

export const savedArtifact = (item: Item): item is ArtifactToolItem => item.kind === "tool" && item.artifact !== undefined;

/** One version of an artifact: the save that made it, its tool item, and its number, counting from 1 in save order. */
export interface ArtifactVersion {
	save: ArtifactSave;
	itemId: string;
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

/** Each artifact with the item index of its latest save, and the version number each saving item made or repeated. */
function fold(items: readonly Item[]): { artifacts: { artifact: Artifact; last: number }[]; numbers: Map<string, number> } {
	const byFile = new Map<string, { artifact: Artifact; last: number }>();
	const numbers = new Map<string, number>();
	items.forEach((item, at) => {
		if (!savedArtifact(item)) return;
		const save = item.artifact;
		const entry = byFile.get(save.file);
		if (!entry) {
			byFile.set(save.file, { artifact: { file: save.file, kind: save.kind, title: save.title, versions: [{ save, itemId: item.id, number: 1 }] }, last: at });
			numbers.set(item.id, 1);
			return;
		}
		const { artifact } = entry;
		entry.last = at;
		artifact.title = save.title;
		artifact.kind = save.kind;
		const latest = artifact.versions.at(-1)!;
		if (latest.save.sha256 !== save.sha256) artifact.versions.push({ save, itemId: item.id, number: latest.number + 1 });
		numbers.set(item.id, artifact.versions.at(-1)!.number);
	});
	return { artifacts: [...byFile.values()], numbers };
}

/** The view's artifacts, most recently saved first, each with its versions in save order; a save equal to the one before it adds no version. */
export function artifactsOf(items: readonly Item[]): Artifact[] {
	return fold(items)
		.artifacts.sort((a, b) => b.last - a.last)
		.map(entry => entry.artifact);
}

/** The version number each saving tool item made, or repeated when its bytes equal the version before. */
export const artifactNumbers = (items: readonly Item[]): ReadonlyMap<string, number> => fold(items).numbers;

/** Whether two lists show the same, so a reader renders only when an artifact or a version changes, not on each streamed token. */
export const sameArtifacts = (a: readonly Artifact[], b: readonly Artifact[]): boolean =>
	a.length === b.length &&
	a.every((artifact, at) => {
		const other = b[at]!;
		return (
			artifact.file === other.file &&
			artifact.kind === other.kind &&
			artifact.title === other.title &&
			artifact.versions.length === other.versions.length &&
			artifact.versions.every((version, i) => {
				const theirs = other.versions[i]!;
				const [save, saved] = [version.save, theirs.save];
				return version.itemId === theirs.itemId && save.sha256 === saved.sha256 && save.title === saved.title && save.note === saved.note && save.bytes === saved.bytes && save.savedAt === saved.savedAt;
			})
		);
	});

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
