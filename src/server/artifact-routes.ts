/** One-version capability links and sandboxed, immutable artifact bytes. */
import { isAbsolute, join } from "node:path";
import { readSessionHeader } from "../omp/sessions";
import { ARTIFACT_VERSIONS_DIR, type ArtifactKind, parseVersionName } from "../shared/artifacts";
import { artifactsDir } from "../subagents";
import { answer, fail } from "./http";
import type { RouteKit, Routes } from "./route-kit";

export interface ArtifactRoutesEnv {
	sessionFileOf(sessionId: string): string | null;
}

const SERVED: Record<ArtifactKind, { type: string; policy: string }> = {
	html: { type: "text/html; charset=utf-8", policy: "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'" },
	svg: { type: "image/svg+xml", policy: "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" },
	markdown: { type: "text/plain; charset=utf-8", policy: "sandbox; default-src 'none'" },
};

function purposeOf(params: URLSearchParams): string | null {
	const session = params.get("session");
	const version = params.get("version");
	return session && version && parseVersionName(version) ? `artifact ${session} ${version}` : null;
}

export function artifactRoutes(kit: RouteKit, env: ArtifactRoutesEnv): Routes {
	return {
		"/api/artifact-link": { GET: kit.get(params => {
			const purpose = purposeOf(params);
			if (!purpose) return fail(400, "Expected ?session= and ?version=<sha256>.<kind>");
			const query = new URLSearchParams({ session: params.get("session")!, version: params.get("version")!, cap: kit.capabilityKey(purpose) });
			return Response.json({ url: `/api/artifact?${query}` }, { headers: { "cache-control": "no-store" } });
		}) },
		"/api/artifact": { GET: kit.capability(purposeOf, (_req, url) => answer(async () => {
			const version = url.searchParams.get("version")!;
			const { kind } = parseVersionName(version)!;
			let sessionFile = env.sessionFileOf(url.searchParams.get("session")!);
			// omp's RPC branch keeps tool results but does not copy their artifacts directory.
			for (let depth = 0; sessionFile?.endsWith(".jsonl") && depth < 8; depth++) {
				const file = Bun.file(join(artifactsDir(sessionFile), ARTIFACT_VERSIONS_DIR, version));
				if (await file.exists()) {
					const served = SERVED[kind];
					return new Response(file, { headers: {
						"content-type": served.type,
						"content-security-policy": served.policy,
						"x-content-type-options": "nosniff",
						"referrer-policy": "no-referrer",
						"cache-control": "private, max-age=31536000, immutable",
					} });
				}
				const parent = (await readSessionHeader(sessionFile))?.parentSession;
				sessionFile = parent ? (isAbsolute(parent) ? parent : env.sessionFileOf(parent)) : null;
			}
			return fail(404, "Artifact version not found");
		}, err => (err as NodeJS.ErrnoException).code === "ENOENT" ? fail(404, "Artifact version not found") : null)) },
	};
}
