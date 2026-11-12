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

/** A keyed cache of one answer per key, asked on first read; a failed ask is asked again by the next reader that mounts. */
function cache(ask: (key: string) => Promise<string>) {
	const store = keyedStore<Loaded<string>>(LOADING);
	const asking = new Map<string, Promise<string>>();
	const load = (key: string): Promise<string> => {
		const known = store.get(key);
		if (known.state === "ready") return Promise.resolve(known.value);
		const pending = asking.get(key);
		if (pending) return pending;
		if (known.state === "failed") store.set(key, LOADING);
		const asked = ask(key).then(
			value => {
				store.set(key, { state: "ready", value });
				return value;
			},
			(error: unknown) => {
				store.set(key, { state: "failed", error: errorText(error) });
				throw error;
			},
		);
		asking.set(key, asked);
		void asked.finally(() => asking.delete(key)).catch(() => {});
		return asked;
	};
	const use = (key: string | null): Loaded<string> => {
		const loaded = store.use(key ?? "");
		useEffect(() => {
			if (key !== null) load(key).catch(() => {});
		}, [key]);
		return key === null ? LOADING : loaded;
	};
	return { load, use };
}

const links = cache(async key => {
	const [session, version] = key.split(" ") as [string, string];
	const { url } = await getJson<{ url: string }>(`/api/artifact-link?${new URLSearchParams({ session, version })}`);
	return url;
});

const texts = cache(async url => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(response.status === 404 ? "This version's saved copy is gone." : `The server answered ${response.status}.`);
	return response.text();
});

/** The capability address of a version of session `sessionId`'s artifact. */
export const useArtifactUrl = (sessionId: string, save: Pick<ArtifactSave, "sha256" | "kind">): Loaded<string> => links.use(`${sessionId} ${versionName(save)}`);

/** The text a capability address serves; nothing is asked while `url` is `null`. */
export const useArtifactText = (url: string | null): Loaded<string> => texts.use(url);

/** The text a capability address serves, from the cache once read, for Copy and Download. */
export const artifactText = (url: string): Promise<string> => texts.load(url);
