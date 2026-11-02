import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OmpFile, Workflow } from "../../../src/shared/models";
import type { Editing } from "./editor";
import { Workflows } from "./workflows-tab";

const editing: Editing = {
	cwd: null,
	catalog: { data: null, error: null },
	write: (send) => send(),
	reload: () => {
		throw new Error("Static rendering must not reload settings");
	},
};

test("packaged workflows show raw source without an editor or a false metadata heading, while authored workflows stay editable", () => {
	const text = "---\nname: review\ndescription: Review changes\nmetadata:\n  tags: workflow\n---\n\n# Review changes\n\nRead the diff.\n";
	const file: OmpFile = {
		kind: "skill",
		scope: "project",
		path: "/work/plugins/review/SKILL.md",
		pathDisplay: "plugins/review/SKILL.md",
		body: { state: "read", text, size: text.length, modifiedAt: 1, hash: "read-revision" },
	};
	const workflow: Workflow = { name: "review", description: "Review changes", skill: file.path, command: null };
	const packaged = renderToStaticMarkup(<Workflows workflows={[workflow]} files={[{ ...file, packaged: "review-kit" }]} editing={editing} />);
	expect(packaged).toContain('href="#settings/extensions"');
	expect(packaged).toContain('aria-label="Contents of plugins/review/SKILL.md"');
	expect(packaged).toContain(text);
	expect(packaged).toContain("Manage package");
	expect(packaged).not.toContain("<h1>");
	expect(packaged).not.toContain(">Edit<");
	const authored = renderToStaticMarkup(<Workflows workflows={[workflow]} files={[file]} editing={editing} />);
	expect(authored).toContain(">Edit<");
	expect(authored).not.toContain("Manage package");
});
