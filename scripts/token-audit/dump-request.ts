/**
 * An omp extension that writes each provider request omp sends, main session and subagents alike, to `$DUMP_DIR`
 * as `<agent>-<n>.json`, so `scripts/token-audit/report.ts --request` can size its system blocks and tool schemas.
 * Usage: `DUMP_DIR=tmp/dumps omp -p --no-session -e scripts/token-audit/dump-request.ts "<prompt>"`.
 */
import { mkdirSync, writeFileSync } from "node:fs";

/** The part of omp's extension API this uses, by hand: `tsc` cannot resolve omp's own package here. */
interface DumpApi {
	on(event: "before_provider_request", handler: (event: { payload: unknown }, ctx: { agent: { kind: "main" | "sub"; name: string } }) => undefined): void;
}

let sent = 0;
export default function dumpRequest(pi: DumpApi) {
	const dir = process.env.DUMP_DIR ?? "tmp/token-audit-dumps";
	mkdirSync(dir, { recursive: true });
	pi.on("before_provider_request", (event, ctx) => {
		sent += 1;
		writeFileSync(`${dir}/${ctx.agent.kind === "sub" ? ctx.agent.name : "main"}-${sent}.json`, JSON.stringify(event.payload, null, 1));
		return undefined;
	});
}
