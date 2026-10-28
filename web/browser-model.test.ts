import { expect, test } from "bun:test";
import type { LiveSessionProcesses, SessionProcess } from "../src/shared/processes";
import { initialAddress, browserCandidates } from "./browser-model";

const running = (label: string, ports: number[], shared = false): SessionProcess => ({
	id: label, kind: shared ? "service" : "job", shared, label, memoryBytes: 0, cpuPercent: 0, processCount: 1, ports, startedAt: 0, stopsAt: null,
});
const session = (instanceId: string, processes: SessionProcess[]): LiveSessionProcesses => ({
	instanceId, omp: { memoryBytes: 0, cpuPercent: 0, processCount: 1 }, processes, otherPorts: [],
});

test("a session's candidates are its own listening ports, in the CPU card's order, without a shared daemon's", () => {
	const sessions = [
		session("other", [running("rails server", [3000])]),
		session("mine", [running("vite", [5173, 24678]), running("browser", [9222], true), running("sleep 600", []), running("api", [4000])]),
	];
	expect(browserCandidates(sessions, "mine")).toEqual([
		{ url: "http://localhost:5173/", label: "vite", port: 5173 },
		{ url: "http://localhost:24678/", label: "vite", port: 24678 },
		{ url: "http://localhost:4000/", label: "api", port: 4000 },
	]);
	expect(browserCandidates(sessions, "gone")).toEqual([]);
	expect(browserCandidates(null, "mine")).toEqual([]);
});

test("the Browser opens on the address last loaded, else the first candidate, else none", () => {
	const candidates = browserCandidates([session("mine", [running("vite", [5173])])], "mine");
	expect(initialAddress("http://127.0.0.1:3000/settings", candidates)).toBe("http://127.0.0.1:3000/settings");
	expect(initialAddress(null, candidates)).toBe("http://localhost:5173/");
	expect(initialAddress("https://example.com/", candidates)).toBe("http://localhost:5173/");
	expect(initialAddress(null, [])).toBeNull();
});
