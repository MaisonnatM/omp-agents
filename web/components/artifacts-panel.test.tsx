import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArtifactSave, Sha256 } from "../../src/shared/artifacts";
import type { Artifact } from "../artifacts-model";
import { VersionBar } from "./artifacts-panel";

const save = (note: string | null): ArtifactSave => ({ file: "page.html", kind: "html", title: "Pricing page", note, sha256: "a".repeat(64) as Sha256, bytes: 2048, savedAt: 0 });

const artifact: Artifact = {
	file: "page.html",
	kind: "html",
	title: "Pricing page",
	versions: [1, 2, 3].map(number => ({ save: save(`note ${number}`), itemIds: [`i${number}`], number })),
};

const bar = (number: number, of: Artifact = artifact) => renderToStaticMarkup(<VersionBar artifact={of} version={of.versions[number - 1]!} onPick={() => {}} />);

/** Whether the arrow named `label` is disabled in `html`: its own tag carries the bare `disabled` attribute. */
function disabled(html: string, label: string): boolean {
	const tag = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
	if (!tag) throw new Error(`No ${label} button`);
	return / disabled=""/.test(tag);
}

test("the version bar disables the arrow past either end and offers Go to latest only off the latest", () => {
	const first = bar(1);
	expect(first).toContain("Version 1 of 3");
	expect(disabled(first, "Older version")).toBe(true);
	expect(disabled(first, "Newer version")).toBe(false);
	expect(first).toContain("Go to latest");

	const last = bar(3);
	expect(disabled(last, "Older version")).toBe(false);
	expect(disabled(last, "Newer version")).toBe(true);
	expect(last).not.toContain("Go to latest");
	expect(last).toContain("note 3");
});

test("a single version shows no arrows or menu", () => {
	const html = bar(1, { ...artifact, versions: artifact.versions.slice(0, 1) });
	expect(html).toContain("Version 1");
	expect(html).not.toContain("Older version");
	expect(html).not.toContain(" of ");
});
