import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangedFile } from "../../src/shared/transcript";
import { ChangedFileList } from "./changed-files-section";

const files: ChangedFile[] = [
	{ path: "web/app.tsx", changes: [{ tool: "edit", kind: "edited", at: null, added: 12, removed: 3, diff: "+1|hello" }] },
	{ path: "src/app.tsx", changes: [{ tool: "edit", kind: "edited", at: null, added: 0, removed: 2, diff: "-1|goodbye" }] },
	{ path: "notes/README.md", changes: [{ tool: "edit", kind: "created", at: null, added: 5, removed: 0, diff: "+1|notes" }] },
];

test("file rows show type icons, duplicate names' folders, and line counts without a search field", () => {
	const html = renderToStaticMarkup(<ChangedFileList files={files} onOpen={() => {}} />);
	expect(html).toContain('aria-label="Files changed"');
	expect(html).toContain("lucide-file-code");
	expect(html).toContain("lucide-file-text");
	expect(html).toContain(">web/</span>");
	expect(html).toContain(">src/</span>");
	expect(html).not.toContain(">notes/</span>");
	expect(html).toContain(">README.md</span>");
	expect(html).toContain("+12");
	expect(html).toContain("−3");
	expect(html).not.toContain("+0");
	expect(html).not.toContain("−0");
	expect(html).not.toContain("<input");
});
