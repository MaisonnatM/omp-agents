import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { rememberUploads, serveUpload } from "./linear-uploads";

/** A Linear upload address whose signature expires `inMs` from now. */
function signed(path: string, inMs = 300_000): string {
	const payload = Buffer.from(JSON.stringify({ exp: Math.floor((Date.now() + inMs) / 1000) })).toString("base64url");
	return `https://uploads.linear.app${path}?signature=head.${payload}.sig`;
}

/** Linear answering every read with an image; the spy records which addresses were read. */
const linear = () =>
	spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response("png", { headers: { "content-type": "image/png" } }), { preconnect: fetch.preconnect }));

const signal = new AbortController().signal;
const noRefresh = async (): Promise<void> => {};

afterEach(() => mock.restore());

test("an upload is served only under the issue whose text named it", async () => {
	const fetch = linear();
	rememberUploads("ENG-1", `![shot](${signed("/org/a")})`);

	const refreshB = mock(noRefresh);
	expect(await serveUpload("ENG-2", "/org/a", null, signal, refreshB)).toBeNull();
	expect(refreshB).toHaveBeenCalledTimes(1);
	expect(fetch).not.toHaveBeenCalled();

	const served = await serveUpload("ENG-1", "/org/a", null, signal, noRefresh);
	expect(served?.status).toBe(200);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(String(fetch.mock.calls[0]?.[0])).toStartWith("https://uploads.linear.app/org/a?");
});

test("an expired address is dropped and signed anew by reading the issue again", async () => {
	const fetch = linear();
	rememberUploads("ENG-3", signed("/org/b", -60_000));
	expect(await serveUpload("ENG-3", "/org/b", null, signal, noRefresh)).toBeNull();

	const refresh = mock(async () => rememberUploads("ENG-3", signed("/org/b")));
	expect((await serveUpload("ENG-3", "/org/b", null, signal, refresh))?.status).toBe(200);
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(fetch).toHaveBeenCalledTimes(1);
});

test("past the bound the oldest address goes, and one signed again counts as new", async () => {
	linear();
	rememberUploads("ENG-4", signed("/org/first"), signed("/org/kept"));
	rememberUploads("ENG-4", ...Array.from({ length: 255 }, (_, index) => signed(`/org/n${index}`)));
	rememberUploads("ENG-4", signed("/org/kept"), signed("/org/last"));

	expect(await serveUpload("ENG-4", "/org/first", null, signal, noRefresh)).toBeNull();
	expect(await serveUpload("ENG-4", "/org/n0", null, signal, noRefresh)).toBeNull();
	expect((await serveUpload("ENG-4", "/org/kept", null, signal, noRefresh))?.status).toBe(200);
	expect((await serveUpload("ENG-4", "/org/n1", null, signal, noRefresh))?.status).toBe(200);
	expect((await serveUpload("ENG-4", "/org/last", null, signal, noRefresh))?.status).toBe(200);
});
