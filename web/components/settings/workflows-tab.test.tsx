import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { frontmatterOf } from "../../../src/frontmatter";
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

test("packaged workflows render read-only with the frontmatter as properties rather than a heading, while authored workflows stay editable", () => {
	const text = "---\nname: review\ndescription: Review changes\nmetadata:\n  tags: workflow\n---\n\n# Review changes\n\nRead the diff.\n";
	const file: OmpFile = {
		kind: "skill",
		scope: "project",
		path: "/work/plugins/review/SKILL.md",
		pathDisplay: "plugins/review/SKILL.md",
		body: { state: "read", text, size: text.length, modifiedAt: 1, hash: "read-revision", frontmatter: frontmatterOf("SKILL.md", text) },
	};
	const workflow: Workflow = { name: "review", description: "Review changes", skill: file.path, command: null };
	const packaged = renderToStaticMarkup(<Workflows workflows={[workflow]} files={[{ ...file, packaged: "review-kit" }]} editing={editing} />);
	expect(packaged).toContain('href="#settings/extensions"');
	expect(packaged).toContain('aria-label="Contents of plugins/review/SKILL.md"');
	expect(packaged).toMatch(/>description<\/dt><dd[^>]*>Review changes<\/dd>/);
	expect(packaged).not.toMatch(/<h\d[^>]*>[^<]*(?:description|tags):/);
	expect(packaged).toContain("<h1>Review changes</h1>");
	expect(packaged).toContain("Manage package");
	expect(packaged).not.toContain(">Edit<");
	const authored = renderToStaticMarkup(<Workflows workflows={[workflow]} files={[file]} editing={editing} />);
	expect(authored).toContain(">Edit<");
	expect(authored).not.toContain("Manage package");
});
