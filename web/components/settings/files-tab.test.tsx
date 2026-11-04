import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OmpFile } from "../../../src/shared/models";
import type { Editing } from "./editor";
import { Files } from "./files-tab";

const editing: Editing = {
	cwd: null,
	catalog: { data: null, error: null },
	write: send => send(),
	reload: () => {
		throw new Error("Static rendering must not reload settings");
	},
};

const read = (text: string): OmpFile["body"] => ({ state: "read", text, size: text.length, modifiedAt: 1, hash: "h" });

test("the rail starts inside the folder holding every file, and a skill's description describes its entry without naming it", () => {
	const files: OmpFile[] = [
		{ kind: "context", scope: "user", path: "/home/me/.omp/agent/AGENTS.md", pathDisplay: "~/.omp/agent/AGENTS.md", body: read("# Rules\n") },
		{ kind: "skill", scope: "user", path: "/home/me/.omp/agent/skills/ship/SKILL.md", pathDisplay: "~/.omp/agent/skills/ship/SKILL.md", body: read("---\nname: ship\ndescription: Ship a change\n---\n# Ship\n") },
		{ kind: "skill", scope: "user", path: "/home/me/.agents/skills/teach/SKILL.md", pathDisplay: "~/.agents/skills/teach/SKILL.md", body: read("# Teach\n") },
	];
	const html = renderToStaticMarkup(<Files files={files} editing={editing} selected={files[1]!.path} onSelect={() => {}} />);
	const rail = html.slice(html.indexOf('<nav aria-label="omp files"'), html.indexOf("</nav>"));
	expect(rail).not.toContain(">~<");
	expect(rail).toContain(">.omp/agent<");
	expect(rail).toContain(">.agents/skills<");
	const ship = /<button[^>]*aria-label="ship"[^>]*aria-describedby="([^"]+)"/.exec(rail);
	expect(ship).not.toBeNull();
	expect(rail).toMatch(new RegExp(`id="${ship![1]}"[^>]*>Ship a change<`));
	expect(rail).not.toMatch(/aria-label="teach"/);
});
