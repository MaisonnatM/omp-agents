/** Storage usage and explicit native or sandbox cleanup, with no request idle deadline. */
import { gcApply, gcPreview, storageUsage } from "../omp/gc";
import { CleanupBusy, parseCleanupRequest, type CleanupStepResult, type SandboxPlan, type SandboxResult } from "../shared/storage";
import { answer, checked, fail } from "./http";
import type { Handler, RouteKit, Routes, SessionRoutesEnv } from "./routes";

export interface StorageRoutesEnv {
	preview(): Promise<SandboxPlan[]>;
	/** Removes each sandbox that still qualifies; `discardChanges` lets one go whose checkout holds changes. */
	remove(paths: readonly string[], discardChanges: boolean): Promise<SandboxResult[]>;
}

function untimed(handler: Handler): Handler {
	return (request, server) => {
		server.timeout(request, 0);
		return handler(request, server);
	};
}

export function storageRoutes({ get, write }: RouteKit, sweep: StorageRoutesEnv, sessions: Pick<SessionRoutesEnv, "knownWorkspaces" | "addedCwds">): Routes {
	const usage = get(params => {
		const cwd = params.get("cwd");
		if (cwd !== null && !sessions.knownWorkspaces().includes(cwd) && !sessions.addedCwds().includes(cwd)) return fail(404, "Choose a known workspace.");
		return answer(() => storageUsage(cwd));
	});
	const cleanup = write(
		body => checked(parseCleanupRequest(body), "Expected a cleanup preview or one cleanup step."),
		async request => {
			if (request.action === "preview") return request.step === "sandboxes" ? { sandboxes: await sweep.preview() } : { gc: await gcPreview() };
			const result: CleanupStepResult = request.step === "sandboxes" || request.step === "changedSandboxes"
				? { step: request.step, sandboxes: await sweep.remove(request.sandboxes, request.step === "changedSandboxes") }
				: { step: request.step, gc: await gcApply(request.step) };
			return result;
		},
		error => error instanceof CleanupBusy ? fail(409, error.message) : null,
	);
	return {
		"/api/storage": { GET: untimed(usage) },
		"/api/storage/cleanup": { PUT: untimed(cleanup) },
	};
}
