import { afterEach, describe, expect, test, vi } from "bun:test";
import type { UserRequest } from "./shared";
import { PendingRequests, parseCollabRequest, parseRpcRequest, rpcResponse } from "./user-requests";

const NOW = 1_790_000_000_000;

afterEach(() => {
	vi.useRealTimers();
});

describe("parseRpcRequest", () => {
	test("maps each dialog method and its cancel, and ignores fire-and-forget frames", () => {
		const frame = (method: string, fields: Record<string, unknown>) => ({ type: "extension_ui_request", id: "r1", method, ...fields });
		expect(
			parseRpcRequest(
				frame("select", { title: "Pick", options: ["Red", "Blue"], optionDetails: [{}, { description: " calm " }], timeout: 30_000 }),
				NOW,
			),
		).toEqual({
			kind: "add",
			request: {
				id: "r1",
				title: "Pick",
				deadline: NOW + 30_000,
				kind: "select",
				options: [
					{ label: "Red", description: null },
					{ label: "Blue", description: "calm" },
				],
				checked: [],
			},
		});
		expect(parseRpcRequest(frame("confirm", { title: "Deploy?", message: "To staging" }), NOW)).toEqual({
			kind: "add",
			request: { id: "r1", title: "Deploy?", deadline: null, kind: "confirm", message: "To staging" },
		});
		expect(parseRpcRequest(frame("input", { title: "Name", placeholder: "e.g. x" }), NOW)).toEqual({
			kind: "add",
			request: { id: "r1", title: "Name", deadline: null, kind: "text", multiline: false, placeholder: "e.g. x", prefill: "" },
		});
		expect(parseRpcRequest(frame("editor", { title: "Notes", prefill: "draft" }), NOW)).toEqual({
			kind: "add",
			request: { id: "r1", title: "Notes", deadline: null, kind: "text", multiline: true, placeholder: null, prefill: "draft" },
		});
		expect(parseRpcRequest(frame("cancel", { targetId: "r0" }), NOW)).toEqual({ kind: "cancel", id: "r0" });
		expect(parseRpcRequest(frame("notify", { message: "hi" }), NOW)).toBeNull();
		expect(parseRpcRequest(frame("select", { title: "Pick", options: [1, 2] }), NOW)).toBeNull();
	});
});

test("rpcResponse writes omp's extension_ui_response for each answer", () => {
	expect(rpcResponse("r1", { kind: "value", value: "Blue" })).toEqual({ type: "extension_ui_response", id: "r1", value: "Blue" });
	expect(rpcResponse("r1", { kind: "confirm", confirmed: false })).toEqual({ type: "extension_ui_response", id: "r1", confirmed: false });
	expect(rpcResponse("r1", { kind: "cancel" })).toEqual({ type: "extension_ui_response", id: "r1", cancelled: true });
});

describe("parseCollabRequest", () => {
	test("keeps checked rows of a checkbox select and drops indices past the rows", () => {
		const request = {
			reqId: 7,
			kind: "select",
			title: "Languages",
			options: [{ label: "TypeScript", description: "typed JS" }, "Rust", "Next →"],
			selectionMarker: "checkbox",
			checkedIndices: [0, 9],
			markableCount: 2,
		};
		expect(parseCollabRequest(request)).toEqual({
			id: "7",
			title: "Languages",
			deadline: null,
			kind: "select",
			options: [
				{ label: "TypeScript", description: "typed JS" },
				{ label: "Rust", description: null },
				{ label: "Next →", description: null },
			],
			checked: [0],
		});
	});

	test("reads an editor as a multi-line text request and a radio select as unchecked", () => {
		expect(parseCollabRequest({ reqId: 8, kind: "editor", title: "Custom answer: Languages" })).toEqual({
			id: "8",
			title: "Custom answer: Languages",
			deadline: null,
			kind: "text",
			multiline: true,
			placeholder: null,
			prefill: "",
		});
		expect(parseCollabRequest({ reqId: 9, kind: "select", title: "Ship?", options: ["Yes"], selectionMarker: "radio", checkedIndices: [0] })).toEqual({
			id: "9",
			title: "Ship?",
			deadline: null,
			kind: "select",
			options: [{ label: "Yes", description: null }],
			checked: [],
		});
	});
});

describe("PendingRequests", () => {
	const select = (id: string, deadline: number | null = null): Extract<UserRequest, { kind: "select" }> => ({
		id,
		title: "Pick",
		deadline,
		kind: "select",
		options: [{ label: "Red", description: null }],
		checked: [],
	});

	test("takes only answers the request can take, then forgets it", () => {
		const pending = new PendingRequests(() => {});
		pending.add(select("a"));
		pending.add({ id: "b", title: "Deploy?", deadline: null, kind: "confirm", message: "" });
		expect(pending.take("a", { kind: "value", value: "Green" })).toBe(false);
		expect(pending.take("a", { kind: "confirm", confirmed: true })).toBe(false);
		expect(pending.take("b", { kind: "value", value: "Red" })).toBe(false);
		expect(pending.list().map(request => request.id)).toEqual(["a", "b"]);
		expect(pending.take("a", { kind: "value", value: "Red" })).toBe(true);
		expect(pending.take("a", { kind: "value", value: "Red" })).toBe(false);
		expect(pending.take("b", { kind: "cancel" })).toBe(true);
		expect(pending.list()).toEqual([]);
	});

	test("a resent request replaces its copy in place", () => {
		const pending = new PendingRequests(() => {});
		pending.add(select("a"));
		pending.add(select("b"));
		pending.add({ ...select("a"), checked: [0] });
		expect(pending.list().map(request => [request.id, request.kind === "select" ? request.checked : null])).toEqual([
			["a", [0]],
			["b", []],
		]);
	});

	test("a request leaves at its deadline and reports the change", () => {
		vi.useFakeTimers({ now: NOW });
		let changes = 0;
		const pending = new PendingRequests(() => changes++);
		pending.add(select("a", NOW + 30_000));
		pending.add(select("b"));
		vi.advanceTimersByTime(29_999);
		expect(pending.list().map(request => request.id)).toEqual(["a", "b"]);
		vi.advanceTimersByTime(1);
		expect(pending.list().map(request => request.id)).toEqual(["b"]);
		expect(changes).toBe(3);
	});

	test("clear drops every request and its deadline timer", () => {
		vi.useFakeTimers({ now: NOW });
		let changes = 0;
		const pending = new PendingRequests(() => changes++);
		pending.add(select("a", NOW + 30_000));
		pending.clear();
		vi.advanceTimersByTime(60_000);
		expect(pending.list()).toEqual([]);
		expect(changes).toBe(2);
	});
});
