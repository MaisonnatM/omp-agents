import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleAccountsFile } from "./google-accounts-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const accountsPath = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-google-accounts-"));
	dirs.push(dir);
	return join(dir, "google-accounts.json");
};

test("learned addresses, forgotten accounts, and workspace links persist as the extension reads them, and a change that changes nothing saves nothing", () => {
	const path = accountsPath();
	const file = new GoogleAccountsFile(path);
	expect(file.apply({ kind: "learn", account: "gmail", address: "max@example.com" })).toBe(true);
	expect(file.apply({ kind: "learn", account: "gmail", address: "max@example.com" })).toBe(false);
	expect(file.apply({ kind: "learn", account: "gmail-2", address: "max@acme.com" })).toBe(true);
	expect(file.apply({ kind: "link", address: "max@acme.com", workspaces: ["/code/acme", "/code/acme"] })).toBe(true);
	expect(file.apply({ kind: "link", address: "max@acme.com", workspaces: ["/code/acme"] })).toBe(false);
	expect(file.apply({ kind: "forget", accounts: ["gmail", "gone"] })).toBe(true);
	expect(file.apply({ kind: "forget", accounts: ["gone"] })).toBe(false);
	file.flush();
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ addresses: { "gmail-2": "max@acme.com" }, links: { "max@acme.com": ["/code/acme"] }, signedOut: {} });
	expect(file.apply({ kind: "link", address: "max@acme.com", workspaces: [] })).toBe(true);
	file.flush();
	expect(new GoogleAccountsFile(path).value.links.size).toBe(0);
});

test("a sign-out report keeps its first time until it settles or its account is forgotten, and a file from before reports reads as none", () => {
	const path = accountsPath();
	writeFileSync(path, JSON.stringify({ addresses: { gmail: "max@example.com" }, links: {} }));
	const file = new GoogleAccountsFile(path);
	expect(file.value.signedOut.size).toBe(0);
	expect(file.apply({ kind: "signed-out", account: "gmail", at: 5 })).toBe(true);
	expect(file.apply({ kind: "signed-out", account: "gmail", at: 9 })).toBe(false);
	expect(file.apply({ kind: "signed-out", account: "google-calendar", at: 7 })).toBe(true);
	file.flush();
	expect(JSON.parse(readFileSync(path, "utf8")).signedOut).toEqual({ gmail: 5, "google-calendar": 7 });
	expect(file.apply({ kind: "settle", account: "gmail" })).toBe(true);
	expect(file.apply({ kind: "settle", account: "gmail" })).toBe(false);
	expect(file.apply({ kind: "forget", accounts: ["google-calendar"] })).toBe(true);
	file.flush();
	expect(new GoogleAccountsFile(path).value.signedOut.size).toBe(0);
});
