/**
 * What the smoke scripts share: the token they sign in with, the sign-in of a browser context, the build the running
 * dashboard serves, and whether that build is what a local checkout holds now.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "playwright-core";
import { tokenFile } from "../src/paths";
import { type Provenance, provenance, readSourceIdentity, type ServedBuild, type SourceIdentity } from "../src/served-build";
import { pageAccess } from "../src/server/auth";

/** The token a script signs in with: `given`, else the one in the token file that the server reads. */
export const scriptToken = (given: string | undefined): string => given ?? readFileSync(tokenFile, "utf8").trim();

/** Signs every page of `context` in before its scripts run, as the desktop window's preload does. */
export async function signIn(context: BrowserContext, token: string): Promise<void> {
	await context.addInitScript(entries => {
		for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
	}, pageAccess(token));
}

/** What the scripts know of the dashboard they check, and whether it serves the local checkout. */
export interface ServedCheck {
	/** The dashboard's origin, `http://127.0.0.1:<port>`. */
	url: string;
	served: ServedBuild;
	local: SourceIdentity;
	provenance: Provenance;
}

/**
 * Asks the dashboard at `origin` what it serves and compares it with what `checkout` holds now, by default the
 * checkout these scripts live in. Throws when the server does not take `token` or does not answer the build, or
 * `checkout` is in no git checkout.
 */
export async function checkServed(origin: string, token: string, checkout = join(import.meta.dir, "..")): Promise<ServedCheck> {
	const answer = await fetch(new URL("/api/dashboard/build", origin), { headers: { authorization: `Bearer ${token}` } });
	if (answer.status === 404) throw new Error(`${origin} answers no /api/dashboard/build: it runs code older than these scripts, so restart it from this checkout`);
	if (!answer.ok) throw new Error(`${origin} answered ${answer.status} for its build: ${await answer.text()}`);
	const served = (await answer.json()) as ServedBuild;
	const local = await readSourceIdentity(checkout);
	if (!local) throw new Error(`${checkout} is in no git checkout`);
	return { url: origin, served, local, provenance: provenance(served, local) };
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
