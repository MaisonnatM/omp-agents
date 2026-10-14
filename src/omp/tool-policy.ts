/** The saved tool restriction on a session's branch, restored before its RPC process starts. */
import { isObject } from "../json";
import { parseTools } from "../shared/sessions";
import { loader } from "./modules";

/** Custom session entry written by the restricted runner. */
export const TOOL_POLICY_ENTRY = "omp-agents-tool-allowlist";

/** Policy on the saved branch, or on the ancestor chain of a fork point. */
export async function savedTools(path: string, entryId?: string): Promise<string[] | null> {
	const entries = await loader.loadEntriesFromFile(path);
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	let entry = byId.get(entryId ?? entries.at(-1)?.id ?? "");
	while (entry) {
		if (entry.type === "custom" && "customType" in entry && entry.customType === TOOL_POLICY_ENTRY) {
			const parsed = "data" in entry && isObject(entry.data) ? parseTools(entry.data.tools) : null;
			if (!parsed || parsed.ok === null) throw new Error("The saved session has an invalid tool policy.");
			return parsed.ok;
		}
		entry = entry.parentId ? byId.get(entry.parentId) : undefined;
	}
	return null;
}
