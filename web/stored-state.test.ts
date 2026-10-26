import { expect, test } from "bun:test";

// A new process loads the real module with an in-memory localStorage, so no other test sees its globals.
const scenario = String.raw`
import { adoptPreferences, onStoredChange, sendPreferencesThrough, storedPreferences, storeOrRemove } from "./stored-state.ts";

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };

const sent = [];
const stop = sendPreferencesThrough(change => sent.push(change));
const woken = [];
for (const key of ["omp-agents.theme", "omp-agents.hide-thinking", "omp-agents.pinned-skill"]) onStoredChange(key, () => woken.push(key));
const results = {};

storeOrRemove("omp-agents.theme", "dark", "system");
storeOrRemove("omp-agents.theme", "dark", "system");
storeOrRemove("omp-agents.hide-thinking", "true", "false");
storeOrRemove("omp-agents.split-columns", "0.4", "0.5");
storeOrRemove("omp-agents.hide-thinking", "false", "false");
results.written = { sent: sent.splice(0), seed: storedPreferences() };

woken.length = 0;
adoptPreferences({ "omp-agents.theme": "dark", "omp-agents.pinned-skill": "review" });
results.adopted = { sent: sent.splice(0), woken: woken.splice(0), stored: Object.fromEntries(memory) };
adoptPreferences({ "omp-agents.pinned-skill": "review" });
results.removed = { woken: woken.splice(0), theme: memory.get("omp-agents.theme") ?? null };

stop();
storeOrRemove("omp-agents.theme", "light", "system");
results.stopped = sent;
console.log(JSON.stringify(results));
`;

test("a change to a portable preference goes to the server once, and the server's preferences land without echo, waking only changed keys", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({
		written: {
			sent: [
				{ op: "set", key: "omp-agents.theme", value: "dark" },
				{ op: "set", key: "omp-agents.hide-thinking", value: "true" },
				{ op: "set", key: "omp-agents.hide-thinking", value: null },
			],
			seed: { "omp-agents.theme": "dark" },
		},
		adopted: {
			sent: [],
			woken: ["omp-agents.pinned-skill"],
			stored: { "omp-agents.theme": "dark", "omp-agents.split-columns": "0.4", "omp-agents.pinned-skill": "review" },
		},
		removed: { woken: ["omp-agents.theme"], theme: null },
		stopped: [],
	});
});
