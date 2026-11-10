// Gives a chrome-devtools MCP call without a `pageId` the first page, `1`: every page tool requires one, and a call that
// leaves it out fails omp's schema check. omp checks a `write xd://<tool>` device call's JSON after the outer `write`'s
// `tool_call` hooks run, so this revises that `write`; a tool called by its own name is checked before any hook sees it.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** The device path prefix of the `chrome-devtools` server's tools, as omp mints their names. */
const DEVICE = "xd://mcp__chrome_devtools_";
/** Tools that take no `pageId`, or whose `pageId` names the page they close or select rather than the page they act on. */
const NO_DEFAULT: Record<string, true> = { list_pages: true, new_page: true, close_page: true, select_page: true };

/** `content` with `pageId: 1` when it is a JSON object of arguments for device `tool` that leaves the page out, else `undefined`. */
export function withFirstPage(tool: string, content: string): string | undefined {
	if (Object.hasOwn(NO_DEFAULT, tool)) return undefined;
	let args: unknown;
	try {
		args = JSON.parse(content);
	} catch {
		return undefined;
	}
	if (!args || typeof args !== "object" || Array.isArray(args) || "pageId" in args) return undefined;
	return JSON.stringify({ ...args, pageId: 1 });
}

export default function chromeDevtoolsPage(pi: ExtensionAPI) {
	pi.on("tool_call", async event => {
		if (event.toolName !== "write") return;
		const { path, content } = event.input;
		if (typeof path !== "string" || !path.startsWith(DEVICE) || typeof content !== "string") return;
		const revised = withFirstPage(path.slice(DEVICE.length), content);
		return revised === undefined ? undefined : { input: { ...event.input, content: revised } };
	});
}
