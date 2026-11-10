import { lstat, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
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
		const path = join(root, "models.yml");
		await Bun.write(path, "# keep me\nproviders:\n  other:\n    baseUrl: https://example.com\n");
		expect(await addApiCreditsProvider(["claude-sonnet"], root)).toBe(true);
		expect(await addApiCreditsProvider(["unused"], root)).toBe(false);
		const text = await readFile(path, "utf8");
		expect(text).toContain("# keep me");
		expect(text).toContain("other:");
		expect(text).toContain("claude-sonnet");
		expect(text).not.toContain("unused");
	});

	test("removes only the marked entry this module wrote", async () => {
		const root = await dir();
		const path = join(root, "models.yml");
		await Bun.write(path, "# keep me\nproviders:\n  other:\n    baseUrl: https://example.com\n");
		await addApiCreditsProvider(["claude-sonnet"], root);
		await removeApiCreditsProvider(root);
		const text = await readFile(path, "utf8");
		expect(text).toContain("# keep me");
		expect(text).toContain("other:");
		expect(text).not.toContain("anthropic-api");

		await Bun.write(path, Bun.YAML.stringify({ providers: { "anthropic-api": { ...apiCreditsEntry(["kept"]), auth: "apiKey", apiKey: "stay" } } }, null, 2));
		await removeApiCreditsProvider(root);
		expect(await readFile(path, "utf8")).toContain("apiKey");
	});

	test("an existing models.yml keeps its permissions and stays a symlink to the file it points at", async () => {
		const root = await dir();
		const link = join(root, "models.yml");
		const real = join(await dir(), "models.yml");
		await writeFile(real, "providers:\n  other:\n    apiKey: secret\n", { mode: 0o600 });
		await symlink(real, link);

		await addApiCreditsProvider(["claude-sonnet"], root);
		expect((await lstat(link)).isSymbolicLink()).toBe(true);
		expect(await readFile(real, "utf8")).toContain("claude-sonnet");
		expect((await stat(real)).mode & 0o777).toBe(0o600);

		await removeApiCreditsProvider(root);
		expect((await lstat(link)).isSymbolicLink()).toBe(true);
		expect(await readFile(real, "utf8")).not.toContain("anthropic-api");
		expect((await stat(real)).mode & 0o777).toBe(0o600);
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
