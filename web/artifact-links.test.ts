/** Each version's address and text are asked once for every reader, and a failed text is asked again by the next reader that mounts. */
import { expect, test } from "bun:test";

const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop, querySelector: () => null };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
Object.assign(globalThis, { window: globalThis, document, addEventListener: noop, removeEventListener: noop, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
const asked = [];
const texts = [new Response("shared"), new Response("Artifact version not found", { status: 404 }), new Response("saved copy")];
globalThis.fetch = async url => {
	asked.push(String(url).split("?")[0]);
	if (String(url).startsWith("/api/artifact-link?")) return Response.json({ url: "/api/artifact?" + String(url).split("?")[1] });
	return texts.shift();
};
const { createRoot } = await import("react-dom/client");
const { useArtifactVersion } = await import("./artifact-links.ts");

const seen = {};
function Reader({ name, sha }) {
	seen[name] = useArtifactVersion("main", { sha256: sha.repeat(64), kind: "html" });
	return null;
}
// One turn of the event loop, no wait: the stubbed fetches and their bodies resolve within it.
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));
const root = createRoot(container);
await act(async () => root.render([createElement(Reader, { key: "one", name: "one", sha: "a" }), createElement(Reader, { key: "two", name: "two", sha: "a" })]));
await settle();
const shared = { asked: asked.splice(0), one: seen.one, two: seen.two };
await act(async () => root.render(createElement(Reader, { key: "gone", name: "gone", sha: "b" })));
await settle();
const failed = seen.gone;
await act(async () => root.render(null));
await act(async () => root.render(createElement(Reader, { key: "gone", name: "gone", sha: "b" })));
await settle();
console.log(JSON.stringify({ shared, failed, retried: seen.gone, asked }));
`;

test("two readers share one link and one text read; a failed text is asked again once a reader mounts", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const { shared, failed, retried, asked } = JSON.parse(stdout);
	expect(shared.asked).toEqual(["/api/artifact-link", "/api/artifact"]);
	expect([shared.one.state, shared.one.value.text, shared.two.value.text]).toEqual(["ready", "shared", "shared"]);
	expect(failed).toEqual({ state: "failed", error: "This version's saved copy is gone. Pick another version." });
	expect([retried.state, retried.value.text]).toEqual(["ready", "saved copy"]);
	expect(asked).toEqual(["/api/artifact-link", "/api/artifact", "/api/artifact"]);
});
