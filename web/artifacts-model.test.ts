import { describe, expect, test } from "bun:test";
import type { ArtifactSave, Sha256 } from "../src/shared/artifacts";
import type { Item } from "../src/shared/transcript";
import { artifactNumbers, artifactsOf, landedSaves, pickedVersion, sameArtifacts } from "./artifacts-model";

const sha = (char: string): Sha256 => char.repeat(64) as Sha256;
const save = (file: string, hash: string, extra: Partial<ArtifactSave> = {}): ArtifactSave => ({
	file,
	kind: file.endsWith(".svg") ? "svg" : file.endsWith(".md") ? "markdown" : "html",
	title: file,
	note: null,
	sha256: sha(hash),
	bytes: 10,
	savedAt: 1_700_000_000_000,
	...extra,
});
const saved = (id: string, artifact: ArtifactSave): Item => ({ id, kind: "tool", name: "artifact", summary: artifact.file, status: "ok", agents: [], artifact });
const running = (id: string): Item => ({ id, kind: "tool", name: "artifact", summary: "", status: "running", agents: [] });
const reply: Item = { id: "r", kind: "assistant", text: "done", streaming: false, suggestions: [] };

describe("artifactsOf", () => {
	test("groups saves by file, newest saved first, with versions in save order and the latest title", () => {
		const artifacts = artifactsOf([
			saved("1", save("a.html", "a", { title: "Draft" })),
			saved("2", save("b.svg", "b")),
			reply,
			saved("3", save("a.html", "c", { title: "Pricing", note: "Bigger buttons" })),
		]);
		expect(artifacts.map(artifact => artifact.file)).toEqual(["a.html", "b.svg"]);
		expect(artifacts[0]!.title).toBe("Pricing");
		expect(artifacts[0]!.versions.map(version => [version.number, version.itemId, version.save.note])).toEqual([
			[1, "1", null],
			[2, "3", "Bigger buttons"],
		]);
	});

	test("a save equal to the one before adds no version, but equal bytes after a change do", () => {
		const items = [saved("1", save("a.html", "a")), saved("2", save("a.html", "a")), saved("3", save("a.html", "b")), saved("4", save("a.html", "a"))];
		expect(artifactsOf(items)[0]!.versions.map(version => version.itemId)).toEqual(["1", "3", "4"]);
		expect([...artifactNumbers(items)]).toEqual([["1", 1], ["2", 1], ["3", 2], ["4", 3]]);
	});

	test("tool calls without an artifact, such as a running one, add nothing", () => {
		expect(artifactsOf([running("1"), reply])).toEqual([]);
	});
});

describe("sameArtifacts", () => {
	test("equal lists built from new item objects compare equal; a new version or note does not", () => {
		const items = [saved("1", save("a.html", "a"))];
		const first = artifactsOf(items);
		expect(sameArtifacts(first, artifactsOf([saved("1", save("a.html", "a"))]))).toBe(true);
		expect(sameArtifacts(first, artifactsOf([...items, saved("2", save("a.html", "b"))]))).toBe(false);
		expect(sameArtifacts(first, artifactsOf([saved("1", save("a.html", "a", { note: "x" }))]))).toBe(false);
	});
});

describe("pickedVersion", () => {
	const artifacts = artifactsOf([saved("1", save("a.html", "a")), saved("2", save("a.html", "b")), saved("3", save("b.md", "c"))]);

	test("a pick by number stays on that version; latest follows the last one", () => {
		expect(pickedVersion(artifacts, { file: "a.html", version: 1 })?.version.itemId).toBe("1");
		expect(pickedVersion(artifacts, { file: "a.html", version: "latest" })?.version.itemId).toBe("2");
	});

	test("a missing version falls back to the artifact's latest, a missing artifact to the newest artifact's latest", () => {
		expect(pickedVersion(artifacts, { file: "a.html", version: 9 })?.version.itemId).toBe("2");
		expect(pickedVersion(artifacts, { file: "gone.html", version: 1 })?.version.itemId).toBe("3");
		expect(pickedVersion(artifacts, null)?.artifact.file).toBe("b.md");
		expect(pickedVersion([], null)).toBeNull();
	});
});

describe("landedSaves", () => {
	const first = save("a.html", "a");

	test("a reset lands nothing, even with saves in it", () => {
		expect(landedSaves([], { reset: true, items: [saved("1", first)] })).toEqual([]);
	});

	test("a call turning from running to done lands once, and its replay lands nothing", () => {
		const before = [running("1")];
		expect(landedSaves(before, { reset: false, items: [saved("1", first)] })).toEqual([first]);
		expect(landedSaves([saved("1", first)], { reset: false, items: [saved("1", first)] })).toEqual([]);
	});

	test("a new save lands; other items do not", () => {
		expect(landedSaves([reply], { reset: false, items: [reply, saved("2", first), running("3")] })).toEqual([first]);
	});
});
