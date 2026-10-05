import { describe, expect, test } from "bun:test";
import { isListeningLine, listeningLine } from "./address";

describe("the listening line the desktop shell waits for", () => {
	test("matches the server's line on its port, whatever the omp version", () => {
		expect(isListeningLine(listeningLine(4317, "18.4.10"), 4317)).toBe(true);
		expect(isListeningLine(listeningLine(4391, "19.0.0-beta.1"), 4391)).toBe(true);
	});

	test("rejects a server on another port, whose port merely ends the same", () => {
		expect(isListeningLine(listeningLine(4391, "18.4.10"), 4317)).toBe(false);
		expect(isListeningLine(listeningLine(14317, "18.4.10"), 4317)).toBe(false);
	});

	test("rejects the other lines the server prints", () => {
		expect(isListeningLine("Sign in at http://127.0.0.1:4317/?token=abc", 4317)).toBe(false);
		expect(isListeningLine("omp-agents: cannot listen on 127.0.0.1:4317: in use", 4317)).toBe(false);
	});
});
