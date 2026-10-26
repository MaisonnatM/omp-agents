import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { agentDir } from "./omp/config";
import { HOME, projectNotesDir, tokenFile, userNotesDir } from "./paths";
import { DENIED_DIRS, findMediaFile, readTextFile } from "./local-file";
import { MAX_TEXT_FILE_BYTES, MEDIA_FILE_EXTENSIONS } from "./shared/transcript";

const dir = await mkdtemp(join(tmpdir(), "omp-agents-local-file-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("a text file reads whole, under the path it was named by", async () => {
	await writeFile(join(dir, "report.tsv"), "a\tb\n1\t2\n");
	expect(await readTextFile(join(dir, "report.tsv"))).toEqual({
		ok: true,
		file: { path: join(dir, "report.tsv"), text: "a\tb\n1\t2\n", size: 8, truncated: false },
	});
});

test("a link named like a text file cannot open a file of another type", async () => {
	await writeFile(join(dir, "token"), "secret");
	await symlink(join(dir, "token"), join(dir, "notes.md"));
	expect(await readTextFile(join(dir, "notes.md"))).toMatchObject({ ok: false, status: 415 });
});

test("a relative path, a directory, a missing file, and binary bytes are refused", async () => {
	await writeFile(join(dir, "image.txt"), new Uint8Array([0x89, 0x50, 0xff, 0xfe]));
	expect(await readTextFile("notes.md")).toMatchObject({ ok: false, status: 400 });
	expect(await readTextFile(dir)).toMatchObject({ ok: false, status: 404 });
	expect(await readTextFile(join(dir, "missing.md"))).toMatchObject({ ok: false, status: 404 });
	expect(await readTextFile(join(dir, "image.txt"))).toMatchObject({ ok: false, status: 415 });
});

test("a large file stops at the limit without splitting a character", async () => {
	// "é" is two bytes, so the limit falls inside the last one.
	await writeFile(join(dir, "big.log"), `${"a".repeat(MAX_TEXT_FILE_BYTES - 1)}é and more`);
	const read = await readTextFile(join(dir, "big.log"));
	if (!read.ok) throw new Error(read.error);
	expect(read.file.truncated).toBe(true);
	expect(read.file.text).toBe("a".repeat(MAX_TEXT_FILE_BYTES - 1));
});

test("omp-agents' directory and omp's agent directory are denied, Markdown and media in omp's still open", () => {
	expect(DENIED_DIRS.slice(0, 2)).toEqual([
		{ dir: dirname(tokenFile), opens: [] },
		{ dir: agentDir, opens: ["md", "markdown", ...MEDIA_FILE_EXTENSIONS] },
	]);
});

test("the CLIs' sign-ins are denied whole, though their files have text extensions", () => {
	const config = process.env.XDG_CONFIG_HOME || join(HOME, ".config");
	for (const file of [join(config, "gh", "hosts.yml"), join(config, "gcloud", "credentials.db.json"), join(HOME, ".docker", "config.json"), join(HOME, ".kube", "config.yaml"), join(HOME, ".aws", "credentials.toml")]) {
		expect(DENIED_DIRS.some(({ dir, opens }) => file.startsWith(dir + sep) && opens.length === 0)).toBe(true);
	}
});

test("the project's and the user's notes lie outside every denied directory, so the file dialog opens them", () => {
	for (const notes of [projectNotesDir("p1"), userNotesDir]) expect(DENIED_DIRS.filter(({ dir }) => notes === dir || notes.startsWith(dir + sep))).toEqual([]);
});

test("a text file in a denied directory is refused, by its real path, but for the extensions that directory opens", async () => {
	const secrets = join(dir, "secrets");
	const agent = join(dir, "agent");
	await mkdir(join(secrets, "nested"), { recursive: true });
	await mkdir(join(agent, "skills"), { recursive: true });
	await writeFile(join(secrets, "nested", "routines.json"), "{}");
	await writeFile(join(secrets, "notes.md"), "# mine");
	await writeFile(join(agent, "mcp.json"), '{"headers":{}}');
	await writeFile(join(agent, "skills", "SKILL.md"), "# skill");
	await writeFile(join(dir, "secrets-but-not.json"), "{}");
	await symlink(join(agent, "mcp.json"), join(dir, "harmless.json"));
	// The denied directory named through a link still matches the file's real path.
	await symlink(agent, join(dir, "agent-link"));
	const denied = [
		{ dir: secrets, opens: [] },
		{ dir: join(dir, "agent-link"), opens: ["md"] },
	];

	expect(await readTextFile(join(secrets, "nested", "routines.json"), denied)).toMatchObject({ ok: false, status: 403 });
	expect(await readTextFile(join(secrets, "notes.md"), denied)).toMatchObject({ ok: false, status: 403 });
	expect(await readTextFile(join(agent, "mcp.json"), denied)).toMatchObject({ ok: false, status: 403 });
	expect(await readTextFile(join(dir, "harmless.json"), denied)).toMatchObject({ ok: false, status: 403 });
	expect(await readTextFile(join(agent, "skills", "SKILL.md"), denied)).toMatchObject({ ok: true, file: { text: "# skill" } });
	expect(await readTextFile(join(dir, "secrets-but-not.json"), denied)).toMatchObject({ ok: true, file: { text: "{}" } });
});

test("a media file is found by its real path and extension; a link named like one cannot reach another file", async () => {
	await writeFile(join(dir, "Shot.PNG"), new Uint8Array([0x89, 0x50]));
	await writeFile(join(dir, "secret"), "token");
	await symlink(join(dir, "secret"), join(dir, "fake.png"));
	expect(await findMediaFile(join(dir, "Shot.PNG"))).toEqual({ ok: true, real: await realpath(join(dir, "Shot.PNG")), extension: "png" });
	expect(await findMediaFile(join(dir, "fake.png"))).toMatchObject({ ok: false, status: 415 });
	expect(await findMediaFile(join(dir, "report.tsv"))).toMatchObject({ ok: false, status: 415 });
	expect(await findMediaFile(join(dir, "missing.mp4"))).toMatchObject({ ok: false, status: 404 });
	expect(await findMediaFile("shot.png")).toMatchObject({ ok: false, status: 400 });
});

test("a media file in a denied directory is refused unless that directory opens its extension", async () => {
	const secrets = join(dir, "media-secrets");
	await mkdir(secrets, { recursive: true });
	await writeFile(join(secrets, "a.webm"), "");
	expect(await findMediaFile(join(secrets, "a.webm"), [{ dir: secrets, opens: [] }])).toMatchObject({ ok: false, status: 403 });
	expect(await findMediaFile(join(secrets, "a.webm"), [{ dir: secrets, opens: ["webm"] }])).toMatchObject({ ok: true, extension: "webm" });
});
