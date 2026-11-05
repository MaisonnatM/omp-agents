import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { addApiCreditsProvider, apiCreditsEntry, removeApiCreditsProvider, settleApiCredits } from "./api-credits";
import type { AuthStorage, StoredCredential } from "./module-types/models";

function store(rows: StoredCredential[]) {
	let next = rows.reduce((max, row) => Math.max(max, row.id), 0);
	const credentials: AuthStorage["credentials"] = {
		hasOAuth: () => false,
		list: provider => rows.filter(row => row.provider === provider).map(row => ({ ...row, credential: { ...row.credential } })),
		set: async () => {},
		upsert: async (provider, credential) => {
			if (rows.some(row => row.provider === provider && row.credential.type === "api_key" && row.credential.key === credential.key)) return;
			rows.push({ id: ++next, provider, credential: { type: "api_key", key: credential.key } });
		},
		removeById: async (provider, credentialId) => {
			const index = rows.findIndex(row => row.provider === provider && row.id === credentialId);
			if (index < 0) return false;
			rows.splice(index, 1);
			return true;
		},
	};
	return { rows, credentials };
}

async function dir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "api-credits-"));
}

describe("API credits models.yml entry", () => {
	test("adds anthropic-api once, and leaves an entry someone else wrote", async () => {
		const root = await dir();
		expect(await addApiCreditsProvider(["claude-sonnet"], root)).toBe(true);
		expect(await addApiCreditsProvider(["other"], root)).toBe(false);
		const text = await readFile(join(root, "models.yml"), "utf8");
		expect(text).toContain("anthropic-api:");
		expect(text).toContain("claude-sonnet");
		expect(text).not.toContain("other");
	});

	test("removes only the entry this module wrote", async () => {
		const root = await dir();
		await addApiCreditsProvider(["claude-sonnet"], root);
		await removeApiCreditsProvider(root);
		expect(await readFile(join(root, "models.yml"), "utf8")).not.toContain("anthropic-api");

		const kept = join(root, "models.yml");
		await Bun.write(kept, Bun.YAML.stringify({ providers: { "anthropic-api": { ...apiCreditsEntry(["kept"]), auth: "apiKey", apiKey: "stay" } } }, null, 2));
		await removeApiCreditsProvider(root);
		expect(await readFile(kept, "utf8")).toContain("apiKey");
	});

	test("moves a key saved beside the Anthropic sign-in and writes the provider", async () => {
		const root = await dir();
		const { rows, credentials } = store([{ id: 2, provider: "anthropic", credential: { type: "api_key", key: "console-key" } }]);
		const changed = await settleApiCredits(credentials, async () => ["claude-sonnet"], root);
		expect(changed).toBe(true);
		expect(rows.map(row => row.provider)).toEqual(["anthropic-api"]);
		expect(await readFile(join(root, "models.yml"), "utf8")).toContain("claude-sonnet");
		expect(await settleApiCredits(credentials, async () => ["unused"], root)).toBe(false);
	});
});
