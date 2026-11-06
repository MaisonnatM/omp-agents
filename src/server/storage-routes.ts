/** Storage usage and explicit native, sandbox, or package cache cleanup, with no request idle deadline. */
import { gcApply, gcPreview, storageUsage } from "../omp/gc";
import { CACHE_STEP, CleanupBusy, parseCleanupRequest, type CleanupStepResult, type PreviewSource, type Previews, type SandboxPlan, type SandboxResult } from "../shared/storage";
import { cleanCaches, previewCaches } from "./package-caches";
import { answer, checked, fail } from "./http";
import type { Handler, RouteKit, Routes, SessionRoutesEnv } from "./route-kit";

export interface StorageRoutesEnv {
	preview(): Promise<SandboxPlan[]>;
	/** Removes each sandbox that still qualifies; `discardChanges` lets one go whose checkout holds changes. */
	remove(paths: readonly string[], options: { discardChanges?: boolean }): Promise<SandboxResult[]>;
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
	const previews: { [S in PreviewSource]: () => Promise<Pick<Previews, S>> } = {
		gc: async () => ({ gc: await gcPreview() }),
		sandboxes: async () => ({ sandboxes: await sweep.preview() }),
		caches: async () => ({ caches: await previewCaches() }),
	};
	const cleanup = write(
		body => checked(parseCleanupRequest(body), "Expected a cleanup preview or one cleanup step."),
		async request => {
			if (request.action === "preview") return previews[request.source]();
			const result: CleanupStepResult = "sandboxes" in request
				? { step: request.step, sandboxes: await sweep.remove(request.sandboxes, { discardChanges: request.step === "changedSandboxes" }) }
				: request.step === CACHE_STEP ? { step: CACHE_STEP, caches: await cleanCaches() }
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
