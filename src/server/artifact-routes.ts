/** One-version capability links and sandboxed, immutable artifact bytes. */
import { isAbsolute, join } from "node:path";
import type { BunFile } from "bun";
import { readSessionHeader } from "../omp/sessions";
import { ARTIFACT_VERSIONS_DIR, type ArtifactKind, parseVersionName, type Sha256, type VersionName, versionName } from "../shared/artifacts";
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

/** How many session files a version is looked for in: the linked session's, then its fork parents', which also ends a parent link that loops. */
const MAX_FORK_DEPTH = 8;

/** Only a session file has an artifacts directory beside it, so a parent link naming anything else ends the walk. */
const isSessionFile = (path: string | null): path is string => path?.endsWith(".jsonl") ?? false;

/** One version of one session's artifact, as a link's query names it. */
interface VersionRef {
	session: string;
	sha256: Sha256;
	kind: ArtifactKind;
}

function parseRef(params: URLSearchParams): VersionRef | null {
	const session = params.get("session");
	const version = parseVersionName(params.get("version") ?? "");
	return session && version ? { session, ...version } : null;
}

/**
 * The saved copy of version `name` in session `session`'s artifacts directory, or in the nearest fork parent's that
 * holds it: omp's RPC branch keeps tool results but does not copy their artifacts directory.
 */
async function versionFile(env: ArtifactRoutesEnv, session: string, name: VersionName): Promise<BunFile | null> {
	let sessionFile = env.sessionFileOf(session);
	for (let depth = 0; isSessionFile(sessionFile) && depth < MAX_FORK_DEPTH; depth++) {
		const file = Bun.file(join(artifactsDir(sessionFile), ARTIFACT_VERSIONS_DIR, name));
		if (await file.exists()) return file;
		const parent = (await readSessionHeader(sessionFile))?.parentSession;
		sessionFile = parent ? (isAbsolute(parent) ? parent : env.sessionFileOf(parent)) : null;
	}
	return null;
}

export function artifactRoutes(kit: RouteKit, env: ArtifactRoutesEnv): Routes {
	const artifact = kit.capability(parseRef, ref => `artifact ${ref.session} ${versionName(ref)}`);
	const notFound = "Artifact version not found";
	return {
		"/api/artifact-link": { GET: kit.get(params => {
			const ref = parseRef(params);
			if (!ref) return fail(400, "Expected ?session= and ?version=<sha256>.<kind>");
			const query = new URLSearchParams({ session: ref.session, version: versionName(ref), cap: artifact.sign(ref) });
			return Response.json({ url: `/api/artifact?${query}` }, { headers: { "cache-control": "no-store" } });
		}) },
		"/api/artifact": { GET: artifact.serve(ref => answer(async () => {
			const file = await versionFile(env, ref.session, versionName(ref));
			if (!file) return fail(404, notFound);
			const served = SERVED[ref.kind];
			return new Response(file, { headers: {
				"content-type": served.type,
				"content-security-policy": served.policy,
				"x-content-type-options": "nosniff",
				"referrer-policy": "no-referrer",
				"cache-control": "private, max-age=31536000, immutable",
			} });
		}, err => (err as NodeJS.ErrnoException).code === "ENOENT" ? fail(404, notFound) : null)) },
	};
}
