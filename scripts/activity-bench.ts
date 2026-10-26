/**
 * Times the activity store on a throwaway database: 50-event appends, and the 90-day Settings › Activity read
 * (`rows` plus `foldActivity`) over `--rows` seeded rows, `--runs` times each.
 * Usage: `bun scripts/activity-bench.ts --rows 200000 --runs 20`.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { foldActivity } from "../src/activity";
import { windowOf } from "../src/omp/stats";
import { ActivityStore } from "../src/server/activity-store";
import type { ActivityEvent } from "../src/shared/activity";

const { values } = parseArgs({ options: { rows: { type: "string", default: "200000" }, runs: { type: "string", default: "20" } } });
const rows = Number(values.rows);
const runs = Number(values.runs);
const BATCH = 50;
const KEYS = ["home", "session", "pull-requests", "settings/analytics", "todo", "notes"];

const dir = mkdtempSync(join(tmpdir(), "activity-bench-"));
const path = join(dir, "activity.db");
const store = new ActivityStore(path);
const now = Date.now();
const span = 365 * 86_400_000;

/** `count` events numbered from `offset`, spread over the last year. */
function events(count: number, offset: number): ActivityEvent[] {
	return Array.from({ length: count }, (_, index) => {
		const n = offset + index;
		const at = now - span + Math.floor((n / rows) * span);
		return n % 5 === 0 ? { kind: "command", key: "help", via: n % 2 ? "keyboard" : "palette", at } : { kind: "view", key: KEYS[n % KEYS.length]!, via: null, at };
	});
}

const percentile = (samples: number[], p: number): number => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.floor(samples.length * p))]!;

for (let seq = 0; seq < rows; seq += 1000) store.append(crypto.randomUUID(), 0, events(Math.min(1000, rows - seq), seq));

const appends: number[] = [];
const client = crypto.randomUUID();
for (let run = 0; run < runs; run++) {
	const batch = events(BATCH, run * BATCH);
	const start = performance.now();
	store.append(client, run * BATCH, batch);
	appends.push(performance.now() - start);
}

const reads: number[] = [];
for (let run = 0; run < runs; run++) {
	const start = performance.now();
	foldActivity(store.rows(null), windowOf("90d", now).cutoff, now);
	reads.push(performance.now() - start);
}

store.close();
console.log(`rows: ${rows}, runs: ${runs}`);
console.log(`append ${BATCH}: p50 ${percentile(appends, 0.5).toFixed(2)} ms, p95 ${percentile(appends, 0.95).toFixed(2)} ms`);
console.log(`read 90d: p50 ${percentile(reads, 0.5).toFixed(1)} ms`);
console.log(`db size: ${(statSync(path).size / 1_048_576).toFixed(1)} MiB`);
rmSync(dir, { recursive: true, force: true });
