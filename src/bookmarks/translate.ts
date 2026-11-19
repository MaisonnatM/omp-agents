/**
 * The English of the x.com posts in another language, from Google Translate's keyless web endpoint, so the post's text
 * leaves the machine for Google. See docs/architecture/memory-page.md.
 */
import { parseJson } from "../json";
import type { XBookmark } from "../shared/memory-page";
import type { Fetch } from "./x-sync";

/** X's codes for English and for text in no language: undetermined, no linguistic content, a post of only media, mentions, or tags. */
const NOT_TRANSLATED = new Set(["en", "und", "zxx", "qme", "qam", "qct", "qht", "qst"]);
/** How many posts are translated at once. */
const AT_ONCE = 4;

const needsTranslation = (post: XBookmark): boolean => post.lang !== null && !NOT_TRANSLATED.has(post.lang) && post.text.trim() !== "";

/** `text` in English, or `null` when Google did not answer with a translation or answered the text as it was, as for a post X took for another language. */
async function translated(fetch: Fetch, text: string): Promise<string | null> {
	try {
		const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`);
		if (!res.ok) return null;
		const answer = parseJson(await res.text());
		const segments = Array.isArray(answer) && Array.isArray(answer[0]) ? answer[0] : [];
		const english = segments.map(segment => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : "")).join("");
		const same = (value: string): string => value.replace(/\s+/g, "");
		return english.trim() === "" || same(english) === same(text) ? null : english;
	} catch {
		return null;
	}
}

/**
 * `posts` with the English of each one in another language: the translation `kept` holds for the same post and text, else
 * Google's; a post Google could not translate keeps `null`, and the next sync tries again.
 */
export async function translatePosts(fetch: Fetch, posts: readonly XBookmark[], kept: readonly XBookmark[]): Promise<XBookmark[]> {
	const before = new Map(kept.map(post => [post.id, post]));
	const out = posts.map(post => {
		const last = before.get(post.id);
		return last?.translation && last.text === post.text ? { ...post, translation: last.translation } : post;
	});
	const waiting = out.flatMap((post, at) => (post.translation === null && needsTranslation(post) ? [at] : []));
	const work = async (): Promise<void> => {
		for (let at = waiting.shift(); at !== undefined; at = waiting.shift()) {
			const post = out[at] as XBookmark;
			out[at] = { ...post, translation: await translated(fetch, post.text) };
		}
	};
	await Promise.all(Array.from({ length: AT_ONCE }, work));
	return out;
}
