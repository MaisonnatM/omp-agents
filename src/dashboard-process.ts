/** How a dashboard session reaches its omp process, and what that process's phase means for the session. */
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { isObject } from "./json";
import { type AdmittedLaunch, attachRpc, type RpcChild, startRpc } from "./omp/rpc";
import { sessionVisualsExtension } from "./server/resources";

/** `launch` with the extension that tells omp which fenced blocks the dashboard draws as diagrams and charts. */
export function withSessionVisuals(launch: AdmittedLaunch): AdmittedLaunch {
	return { ...launch, args: ["-e", sessionVisualsExtension, ...launch.args] };
}

/** Same shape as a Collab instance id, so the page's hash routing treats both alike. */
export const newInstanceId = (): string => randomBytes(8).toString("hex");

/** The working directory a session file's header records; omp refuses to open the file from any other. */
export async function recordedCwd(sessionFile: string): Promise<string> {
	const head = await Bun.file(sessionFile).slice(0, 1 << 16).text();
	// omp may write a title record ahead of the header.
	const header = head
		.split("\n", 4)
		.map(line => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				return null;
			}
		})
		.find(record => isObject(record) && record.type === "session");
	if (!isObject(header) || typeof header.cwd !== "string") throw new Error("the session file has no readable header");
	if (!(await stat(header.cwd).catch(() => null))?.isDirectory()) throw new Error(`${header.cwd} no longer exists`);
	return header.cwd;
}

/** How a session reaches its omp, which decides what a failed opening does to it. */
export type Opening =
	/** A new omp in `cwd` with `launch`, once `launch` admits `cwd`, which a failed opening stops, so no process outlives a failed start. */
	| { kind: "spawn"; cwd: string; launch: AdmittedLaunch }
	/** The omp a previous server started, which a failed opening leaves running, turn and all, for the next server. */
	| { kind: "attach" };

export async function reach(instanceId: string, opening: Opening, onFrame: (frame: Record<string, unknown>) => void): Promise<{ child: RpcChild; abandon: () => Promise<void> }> {
	switch (opening.kind) {
		case "spawn": {
			const child = await startRpc(instanceId, opening.cwd, onFrame, opening.launch);
			return { child, abandon: () => child.client.stop() };
		}
		case "attach": {
			const child = await attachRpc(instanceId, onFrame);
			return { child, abandon: async () => child.detach() };
		}
		default: {
			const unhandled: never = opening;
			return unhandled;
		}
	}
}

/** omp's process: running; stopping on **End session**; exited, however it came to; or left running for the next server, which is no exit. */
export type ProcessPhase = "running" | "ending" | "exited" | "detached";

/** Why a session in `process` takes no more prompts, or `null` while omp runs. */
export function goneText(process: ProcessPhase): string | null {
	switch (process) {
		case "running":
			return null;
		case "ending":
			return "This session is ending.";
		case "exited":
			return "This session's omp exited; resume it to send more.";
		case "detached":
			return "The server is restarting; send it again once the session is back.";
		default: {
			const unhandled: never = process;
			return unhandled;
		}
	}
}
