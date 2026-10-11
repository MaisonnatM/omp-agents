import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fileTree } from "../file-tree";
import { FileTree } from "./file-tree";

const tree = fileTree(["README.md", "docs/usage.md", "src/server/routes.ts", "src/web/app.tsx"].map(path => ({ path })));

const shown = (open: string | null, startClosed?: boolean): string =>
	renderToStaticMarkup(<FileTree tree={tree} open={open} hrefFor={path => `#repo/x/${path}`} startClosed={startClosed} />);

test("every folder starts open unless the tree starts closed", () => {
	const open = shown(null);
	for (const name of ["README.md", "usage.md", "routes.ts", "app.tsx"]) expect(open).toContain(`>${name}<`);
	const closed = shown(null, true);
	expect(closed).toContain(">README.md<");
	expect(closed).toContain(">docs<");
	expect(closed).toContain(">src<");
	for (const name of ["usage.md", "server", "routes.ts", "app.tsx"]) expect(closed).not.toContain(`>${name}<`);
});

test("a closed tree opens only the folders above the open file", () => {
	const html = shown("src/server/routes.ts", true);
	expect(html).toContain(">server<");
	expect(html).toContain(">routes.ts<");
	expect(html).toContain(">web<");
	expect(html).not.toContain(">app.tsx<");
	expect(html).not.toContain(">usage.md<");
});
