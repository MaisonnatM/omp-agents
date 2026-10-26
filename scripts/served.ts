/**
 * What the smoke scripts share: the running dashboard a sign-in address names, the build it serves, and whether that
 * build is what a local checkout holds now.
 */
import { join } from "node:path";
import { type Provenance, provenance, readSourceIdentity, type ServedBuild, type SourceIdentity } from "../src/served-build";

/** A sign-in address, `http://127.0.0.1:<port>/?token=<token>`, without its token, for a report or a log. */
export function redact(url: string): string {
	const parsed = new URL(url);
	parsed.searchParams.delete("token");
	return parsed.href;
}

/** What the scripts know of the dashboard they check, and whether it serves the local checkout. */
export interface ServedCheck {
	/** The sign-in address, redacted. */
	url: string;
	served: ServedBuild;
	local: SourceIdentity;
	provenance: Provenance;
}

/**
 * Asks the dashboard at sign-in address `url` what it serves and compares it with what `checkout` holds now, by default
 * the checkout these scripts live in. Throws when the address holds no token, the server does not answer the build,
 * or `checkout` is in no git checkout.
 */
export async function checkServed(url: string, checkout = join(import.meta.dir, "..")): Promise<ServedCheck> {
	const signIn = new URL(url);
	const token = signIn.searchParams.get("token");
	if (!token) throw new Error(`${url} holds no ?token=; pass the address the server printed after "Sign in at"`);
	const answer = await fetch(new URL("/api/dashboard/build", signIn.origin), { headers: { authorization: `Bearer ${token}` } });
	if (answer.status === 404) throw new Error(`${redact(url)} answers no /api/dashboard/build: it runs code older than these scripts, so restart it from this checkout`);
	if (!answer.ok) throw new Error(`${redact(url)} answered ${answer.status} for its build: ${await answer.text()}`);
	const served = (await answer.json()) as ServedBuild;
	const local = await readSourceIdentity(checkout);
	if (!local) throw new Error(`${checkout} is in no git checkout`);
	return { url: redact(url), served, local, provenance: provenance(served, local) };
}

/** Why a smoke check must not trust the dashboard, or `null` when it serves the local checkout as it is now. */
export function provenanceProblem(verdict: Provenance): string | null {
	switch (verdict.kind) {
		case "match":
			return null;
		case "unknown":
			return "The server names no git checkout (a packaged app, or a directory outside git), so what it serves cannot be checked; start a smoke server from this checkout.";
		case "other-checkout":
			return `The server serves ${verdict.served}, not ${verdict.local}; start a smoke server from ${verdict.local}.`;
		case "stale":
			return `Restart the smoke server: the checkout changed since it started (served tree ${verdict.served.slice(0, 7)}, now ${verdict.local.slice(0, 7)}).`;
	}
}

/** A run's default name: the local commit and the time, as `tmp/<kind>/<run>` names its directory. */
export const defaultRun = (local: SourceIdentity): string => `${local.commit?.slice(0, 7) ?? "uncommitted"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
