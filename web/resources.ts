/** The reads behind the sidebar's memory card and Settings › Resources, and the words they show for pressure and owners. */
import type { Owner, Pressure, ResourceSample, ResourcesView } from "../src/shared/resources";
import { putJson } from "./api";
import type { Tone } from "./components/gauge-tile";
import { createPolledStore } from "./polled-store";

/** This Mac's memory and who holds it, read every 15 seconds, as often as the server samples. */
export const resourcesStore = createPolledStore<ResourcesView>({ url: () => "/api/resources", pollMs: 15_000 });

/** The last `scope` hours of samples, 24 when `null`, read every minute, as often as the server keeps one. */
export const resourceHistoryStore = createPolledStore<ResourceSample[]>({ url: scope => `/api/resources/history?hours=${scope ?? 24}`, pollMs: 60_000 });

export const PRESSURE_LABEL: Record<Pressure, string> = { normal: "Normal", warn: "High", critical: "Critical", unknown: "Unknown" };
export const PRESSURE_TONE: Record<Pressure, Tone> = { normal: "ok", warn: "low", critical: "out", unknown: "ok" };

const STRAY_REASON: Record<Extract<Owner, { kind: "stray" }>["reason"], string> = {
	unattached: "not attached",
	"orphan-port": "its server is gone",
	"foreign-live": "another server's",
};

/** An owner's name in a row. */
export function ownerName(owner: Owner): string {
	switch (owner.kind) {
		case "session":
			return owner.private ? "Private session" : owner.title;
		case "process":
			return owner.label;
		case "stray":
			return owner.title ?? `Unlisted session on port ${owner.port}`;
		case "mcp":
			return owner.server;
		case "heavy":
			return owner.label;
		case "dashboard":
			return owner.part === "server" ? "Dashboard server" : "Dashboard window";
		default: {
			const never: never = owner;
			return never;
		}
	}
}

/** What kind of owner a row is, muted beside its name. */
export function ownerKind(owner: Owner): string {
	switch (owner.kind) {
		case "session":
			return "Session";
		case "process":
			return "Job or service";
		case "stray":
			// Without a title, the name already says the port.
			return owner.title === null ? `Stray, ${STRAY_REASON[owner.reason]}` : `Stray on port ${owner.port}, ${STRAY_REASON[owner.reason]}`;
		case "mcp":
			return "MCP server";
		case "heavy":
			return "Build or test";
		case "dashboard":
			return "Dashboard";
		default: {
			const never: never = owner;
			return never;
		}
	}
}

/** A stable key for an owner's row. */
export function ownerKey(owner: Owner): string {
	switch (owner.kind) {
		case "session":
			return `session:${owner.instanceId}`;
		case "process":
			return `process:${owner.instanceId}:${owner.id}`;
		case "stray":
			return `stray:${owner.keeperId}`;
		case "mcp":
			return `mcp:${owner.instanceId}:${owner.server}`;
		case "heavy":
			return `heavy:${owner.pid}`;
		case "dashboard":
			return `dashboard:${owner.part}`;
		default: {
			const never: never = owner;
			return never;
		}
	}
}

/** Stops a job, a service, or a stray through `PUT /api/session-processes/stop`. */
export async function stopOwner(owner: Extract<Owner, { kind: "process" | "stray" }>): Promise<void> {
	await putJson("/api/session-processes/stop", owner.kind === "process" ? { instanceId: owner.instanceId, id: owner.id } : { instanceId: owner.keeperId, id: "stray" });
}
