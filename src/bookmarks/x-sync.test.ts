import { expect, test } from "bun:test";
import { tweetEntry, X_PAGE, xUser } from "./fixtures";
import { bookmarkChunks, bookmarksQueryIn, xBookmarksPage } from "./x-sync";

test("maps a page of the Bookmarks answer to bookmarks, with the language X detected, and its next cursor", () => {
	expect(xBookmarksPage(X_PAGE)).toEqual({
		bookmarks: [
			{ source: "x", id: "x:111", url: "https://x.com/omarsar0/status/111", name: "elvis", handle: "@omarsar0", text: "Strong primitives", lang: "en", translation: null, media: [], addedAt: "2026-11-18T14:09:32.000Z" },
			{ source: "x", id: "x:222", url: "https://x.com/old/status/222", name: "Old Shape", handle: "@old", text: "The whole long post", lang: null, translation: null, media: [], addedAt: "2026-11-17T10:00:00.000Z" },
		],
		cursor: "NEXT",
	});
	expect(xBookmarksPage({ errors: [{ message: "nope" }] })).toBeNull();
});

test("reads a post's photos, videos at their highest bitrate, and GIFs, and drops the link X ends the text with to point at them", () => {
	const photo = { type: "photo", url: "https://t.co/media", media_url_https: "https://pbs.twimg.com/media/p.jpg", original_info: { width: 1200, height: 800 }, ext_alt_text: "A chart" };
	const video = {
		type: "video",
		url: "https://t.co/media",
		media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/v.jpg",
		sizes: { large: { w: 1280, h: 720 } },
		video_info: {
			variants: [
				{ content_type: "application/x-mpegURL", url: "https://video.twimg.com/v.m3u8" },
				{ content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/v-640.mp4" },
				{ content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/v-1280.mp4" },
				{ content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/v-320.mp4" },
			],
		},
	};
	const gif = { type: "animated_gif", url: "https://t.co/gif", media_url_https: "https://pbs.twimg.com/tweet_video_thumb/g.jpg", original_info: { width: 480, height: 270 }, video_info: { variants: [{ content_type: "video/mp4", bitrate: 0, url: "https://video.twimg.com/tweet_video/g.mp4" }] } };
	const post = (id: string, full_text: string, legacy: object) => tweetEntry({ __typename: "Tweet", rest_id: id, core: { user_results: xUser("a", "A") }, legacy: { created_at: "Wed Nov 18 14:09:32 +0000 2026", full_text, ...legacy } });
	const page = xBookmarksPage({
		data: {
			bookmark_timeline_v2: {
				timeline: {
					instructions: [
						{
							entries: [
								post("1", "Two views https://t.co/media", { extended_entities: { media: [photo, video] }, entities: { media: [photo] } }),
								post("2", "See https://t.co/other", { entities: { media: [gif] } }),
							],
						},
					],
				},
			},
		},
	});
	expect(page?.bookmarks.map(({ text, media }) => ({ text, media }))).toEqual([
		{
			text: "Two views",
			media: [
				{ kind: "photo", url: "https://pbs.twimg.com/media/p.jpg", width: 1200, height: 800, video: null, alt: "A chart" },
				{ kind: "video", url: "https://pbs.twimg.com/ext_tw_video_thumb/v.jpg", width: 1280, height: 720, video: "https://video.twimg.com/v-1280.mp4", alt: null },
			],
		},
		{ text: "See https://t.co/other", media: [{ kind: "gif", url: "https://pbs.twimg.com/tweet_video_thumb/g.jpg", width: 480, height: 270, video: "https://video.twimg.com/tweet_video/g.mp4", alt: null }] },
	]);
});

test("decodes the character references X escapes in a post's author name and text", () => {
	const post = tweetEntry({ __typename: "Tweet", rest_id: "333", core: { user_results: xUser("esc", "Tom &amp; Jerry") }, legacy: { created_at: "Mon Nov 16 09:00:00 +0000 2026", full_text: "100 PRs/week &gt; 1200 &lt;3 &amp; more" } });
	const page = xBookmarksPage({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ entries: [post] }] } } } });
	expect(page?.bookmarks.map(({ name, text }) => ({ name, text }))).toEqual([{ name: "Tom & Jerry", text: "100 PRs/week > 1200 <3 & more" }]);
});

test("finds the Bookmarks query in the page's chunks, with the page's feature values", () => {
	const html = 'x={69742:"bundle.Bookmarks",34778:"shared~bundle.BookmarkFolders~bundle.Bookmarks",1:"bundle.Home"};y={69742:"333a5c168651be6d",34778:"0123456789abcdef"};"on_flag":{"value":true},"off_flag":{"value":false}';
	expect(bookmarkChunks(html)).toEqual([
		"https://abs.twimg.com/responsive-web/client-web/bundle.Bookmarks.333a5c168651be6da.js",
		"https://abs.twimg.com/responsive-web/client-web/shared~bundle.BookmarkFolders~bundle.Bookmarks.0123456789abcdefa.js",
	]);
	const script = 'e.exports={queryId:"QID",operationName:"Bookmarks",operationType:"query",metadata:{featureSwitches:["on_flag","off_flag","unknown_flag"],fieldToggles:["withPayments"]}}';
	expect(bookmarksQueryIn(html, script)).toEqual({ queryId: "QID", features: { on_flag: true, off_flag: false, unknown_flag: false }, fieldToggles: { withPayments: false } });
	expect(bookmarksQueryIn(html, "nothing here")).toBeNull();
});
