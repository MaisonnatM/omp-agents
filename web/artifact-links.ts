/**
 * Each artifact version's capability address and its text, asked once and kept for the page's life: a version never
 * changes, and its address stays valid while the server keeps its token.
 */
import { useEffect } from "react";
import { type ArtifactSave, versionName } from "../src/shared/artifacts";
import { errorText } from "../src/json";
import { getJson } from "./api";
import { keyedStore } from "./keyed-store";

export type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; error: string };

const LOADING: Loaded<never> = { state: "loading" };

/** A keyed cache of one answer per key, asked by the first reader that mounts; a failed ask is asked again by the next reader that mounts. */
function cache(ask: (key: string) => Promise<string>): (key: string | null) => Loaded<string> {
	const store = keyedStore<Loaded<string>>(LOADING);
	const asking = new Set<string>();
	const load = (key: string): void => {
		const known = store.get(key);
		if (known.state === "ready" || asking.has(key)) return;
		if (known.state === "failed") store.set(key, LOADING);
		asking.add(key);
		void ask(key)
			.then(
				value => store.set(key, { state: "ready", value }),
				(error: unknown) => store.set(key, { state: "failed", error: errorText(error) }),
			)
			.finally(() => asking.delete(key));
	};
	return key => {
		const loaded = store.use(key ?? "");
		useEffect(() => {
			if (key !== null) load(key);
		}, [key]);
		return key === null ? LOADING : loaded;
	};
}

/** Keyed by the link route's own query. */
const useLink = cache(async query => (await getJson<{ url: string }>(`/api/artifact-link?${query}`)).url);

/** Each failure reads as a whole sentence the panel shows as it is. */
const useText = cache(async url => {
	const response = await fetch(url);
	if (response.status === 404) throw new Error("This version's saved copy is gone. Pick another version.");
	if (!response.ok) throw new Error(`Could not load this version. The server answered ${response.status}.`);
	return response.text();
});

/**
 * The capability address of version `save` of session `sessionId`'s artifact, with the text it serves. Every kind waits
 * for the text, so a missing copy says so instead of framing the route's JSON 404, and Copy has the text at hand.
 */
export function useArtifactVersion(sessionId: string, save: Pick<ArtifactSave, "sha256" | "kind">): Loaded<{ url: string; text: string }> {
	const link = useLink(String(new URLSearchParams({ session: sessionId, version: versionName(save) })));
	const text = useText(link.state === "ready" ? link.value : null);
	// The link's failures are the server's words; the text's are whole sentences already.
	if (link.state === "failed") return { state: "failed", error: `Could not load this version. ${link.error}` };
	if (link.state === "ready" && text.state === "ready") return { state: "ready", value: { url: link.value, text: text.value } };
	return text.state === "failed" ? text : LOADING;
}
