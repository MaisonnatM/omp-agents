import { expect, test } from "bun:test";
import { readXVideo } from "./x-video";

test("relays the range of an X video the player asks, without the page's referrer, and refuses any other host", async () => {
	const asked: [string, RequestInit | undefined][] = [];
	const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
		asked.push([url, init]);
		return new Response("1234", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-3/10", "set-cookie": "x=1" } });
	};
	const video = await readXVideo(fetch, "https://video.twimg.com/v.mp4", "bytes=0-3");
	expect([video.status, await video.text(), video.headers.get("content-range"), video.headers.get("content-type"), video.headers.get("set-cookie")]).toEqual([206, "1234", "bytes 0-3/10", "video/mp4", null]);
	expect(asked).toEqual([["https://video.twimg.com/v.mp4", { headers: { range: "bytes=0-3" } }]]);
	expect((await readXVideo(fetch, "https://video.twimg.com.evil.com/v.mp4", null)).status).toBe(404);
	expect((await readXVideo(fetch, null, null)).status).toBe(404);
	expect((await readXVideo(() => Promise.reject(new Error("offline")), "https://video.twimg.com/v.mp4", null)).status).toBe(502);
	expect(asked).toHaveLength(1);
});
