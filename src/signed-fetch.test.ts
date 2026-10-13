import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { ApiError, type SignedFetch, signedFetch } from "./signed-fetch";

class Refused extends Error {}

const sent: Request[] = [];
let answer = (): Response => Response.json({ ok: true });

afterEach(() => {
	sent.length = 0;
	answer = () => Response.json({ ok: true });
	mock.restore();
});

/** A signed fetch with token `t0k` over a stubbed global fetch that records each request and answers `answer()`. */
function call(): SignedFetch {
	const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		sent.push(new Request(input, init));
		return answer();
	};
	spyOn(globalThis, "fetch").mockImplementation(Object.assign(stub, { preconnect: fetch.preconnect }));
	return signedFetch(async () => ({ token: "t0k", refused: () => new Refused("sign in again") }));
}

test("a GET sends the bearer token and reads the answer's JSON", async () => {
	expect(await call()("https://api.example.com/me")).toEqual({ ok: true });
	expect(sent[0].method).toBe("GET");
	expect(sent[0].headers.get("Authorization")).toBe("Bearer t0k");
});

test("a POST sends its body as JSON, a DELETE sends nothing, and an empty answer is null", async () => {
	const fetch = call();
	answer = () => new Response(null, { status: 204 });
	expect(await fetch("https://api.example.com/items", { method: "POST", body: { name: "a" } })).toBeNull();
	expect(await fetch("https://api.example.com/items/1", { method: "DELETE" })).toBeNull();
	expect(sent[0].headers.get("Content-Type")).toBe("application/json");
	expect(await sent[0].json()).toEqual({ name: "a" });
	expect(sent[1].method).toBe("DELETE");
	expect(sent[1].headers.get("Authorization")).toBe("Bearer t0k");
	expect(await sent[1].text()).toBe("");
});

test("a 401 throws the bearer's refusal, and another failure an ApiError with the API's message and status", async () => {
	const fetch = call();
	answer = () => new Response("nope", { status: 401 });
	await expect(fetch("https://api.example.com/me")).rejects.toBeInstanceOf(Refused);
	answer = () => Response.json({ error: { message: "Forbidden" } }, { status: 403 });
	await expect(fetch("https://api.example.com/me")).rejects.toEqual(new ApiError("Forbidden", 403));
	await expect(fetch("https://api.example.com/me")).rejects.toMatchObject({ status: 403 });
	answer = () => new Response("down", { status: 503 });
	await expect(fetch("https://api.example.com/me")).rejects.toThrow("api.example.com answered HTTP 503");
	answer = () => new Response("<html>");
	await expect(fetch("https://api.example.com/me")).rejects.toThrow("api.example.com's API answered something other than JSON: <html>");
});
