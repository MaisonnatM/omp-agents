import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArtifactSave, Sha256 } from "../../src/shared/artifacts";
import { ArtifactCard } from "./artifact-card";

const save = (note: string | null): ArtifactSave => ({ file: "page.html", kind: "html", title: "Pricing page", note, sha256: "a".repeat(64) as Sha256, bytes: 2048, savedAt: 0 });

test("the card names its version and note, and marks the version the tab shows", () => {
	const idle = renderToStaticMarkup(<ArtifactCard save={save("Pro tier stands out")} number={2} showing={false} onOpen={() => {}} />);
	expect(idle).toContain("Version 2 · Pro tier stands out");
	expect(idle).not.toContain("aria-current");

	const showing = renderToStaticMarkup(<ArtifactCard save={save(null)} number={1} showing onOpen={() => {}} />);
	expect(showing).toContain('aria-current="true"');
	expect(showing).toContain("Showing");
	expect(showing).not.toContain(" · null");
});
