/**
 * Zen's side of the Memory module's bookmarks: its profile, its bookmarks from `places.sqlite`, and its x.com sign-in from
 * `cookies.sqlite`. See docs/architecture/memory-page.md.
 */
import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ZenBookmark } from "../shared/memory-page";

/** Where Zen keeps its profiles and `profiles.ini` on macOS. */
export const zenDir = (home: string): string => join(home, "Library", "Application Support", "zen");

/** The profile's databases this module reads, each with a write-ahead log beside it. */
export const PLACES = "places.sqlite";
export const COOKIES = "cookies.sqlite";

/** The profile Zen opens, as `profiles.ini` in `dir` names it: the install's default, else the profile marked default; `null` when there is none. */
export function zenProfileDir(dir: string): string | null {
	let ini: string;
	try {
		ini = readFileSync(join(dir, "profiles.ini"), "utf8");
	} catch {
		return null;
	}
	const sections: Record<string, string>[] = [];
	for (const line of ini.split(/\r?\n/)) {
		if (/^\[.*\]$/.test(line.trim())) sections.push({ section: line.trim().slice(1, -1) });
		else {
			const at = line.indexOf("=");
			const current = sections.at(-1);
			if (at > 0 && current) current[line.slice(0, at).trim()] = line.slice(at + 1).trim();
		}
	}
	const install = sections.find(({ section, Default }) => section?.startsWith("Install") && Default)?.Default;
	const marked = sections.find(({ section, Default, Path }) => section?.startsWith("Profile") && Default === "1" && Path);
	const relative = install ?? marked?.Path;
	if (!relative) return null;
	const path = marked && !install && marked.IsRelative === "0" ? relative : join(dir, relative);
	return existsSync(path) ? path : null;
}

/**
 * Runs `read` on a copy of the database at `path` with its write-ahead log, so the rows Zen has not checkpointed yet
 * count too; Zen holds the original locked while it runs. The copy is deleted after.
 */
function withSnapshot<T>(path: string, read: (db: Database) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-zen-"));
	try {
		const copy = join(dir, basename(path));
		cpSync(path, copy);
		if (existsSync(`${path}-wal`)) cpSync(`${path}-wal`, `${copy}-wal`);
		const db = new Database(copy);
		try {
			return read(db);
		} finally {
			db.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** A folder row of `moz_bookmarks`. */
export interface ZenFolder {
	id: number;
	parent: number;
	title: string | null;
	guid: string;
}

/** A bookmark row of `moz_bookmarks` joined to its `moz_places` row; `dateAdded` in microseconds. */
export interface ZenRow {
	guid: string;
	parent: number;
	url: string;
	title: string | null;
	dateAdded: number;
}

/** The roots Zen's bookmarks menu names, by guid. */
const ROOT_NAMES: Record<string, string> = {
	menu________: "Menu",
	toolbar_____: "Toolbar",
	unfiled_____: "Other",
	mobile______: "Mobile",
};
/** The root above every other, which names no folder. */
const TOP_ROOT = "root________";
/** The root of the tags, whose bookmarks are tags, never shown. */
const TAGS_ROOT = "tags________";

/** The rows as bookmarks, each with its folders from the root down, such as `["Toolbar", "Design"]`; none under the tags root or for a `place:` query. */
export function zenBookmarks(folders: readonly ZenFolder[], rows: readonly ZenRow[]): ZenBookmark[] {
	const byId = new Map(folders.map(folder => [folder.id, folder]));
	const paths = new Map<number, string[] | null>();
	const pathOf = (id: number): string[] | null => {
		const known = paths.get(id);
		if (known !== undefined) return known;
		const folder = byId.get(id);
		const root = folder && Object.hasOwn(ROOT_NAMES, folder.guid) ? ROOT_NAMES[folder.guid] : undefined;
		let path: string[] | null;
		if (!folder || folder.guid === TOP_ROOT) path = [];
		else if (folder.guid === TAGS_ROOT) path = null;
		else if (root) path = [root];
		else {
			paths.set(id, []);
			const above = pathOf(folder.parent);
			path = above && [...above, folder.title || "Untitled"];
		}
		paths.set(id, path);
		return path;
	};
	return rows.flatMap(({ guid, parent, url, title, dateAdded }) => {
		const folder = pathOf(parent);
		if (!folder || url.startsWith("place:")) return [];
		return [
			{
				source: "zen" as const,
				id: `zen:${guid}`,
				url,
				title: title || url,
				folder,
				addedAt: new Date(dateAdded / 1000).toISOString(),
			},
		];
	});
}

/** Zen's bookmarks in the profile `profileDir`, or `null` when it holds no `places.sqlite`. */
export function readZenBookmarks(profileDir: string): ZenBookmark[] | null {
	const places = join(profileDir, PLACES);
	if (!existsSync(places)) return null;
	return withSnapshot(places, db =>
		zenBookmarks(
			db.query<ZenFolder, []>("SELECT id, parent, title, guid FROM moz_bookmarks WHERE type = 2").all(),
			db.query<ZenRow, []>("SELECT b.guid, b.parent, p.url, COALESCE(NULLIF(b.title, ''), p.title) AS title, b.dateAdded FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1").all(),
		),
	);
}

/** The x.com sign-in Zen holds: the two cookies a request to X's API needs. Never logged or kept. */
export interface XCookies {
	authToken: string;
	ct0: string;
}

/** The x.com sign-in in the profile `profileDir`, each cookie's newest, or `null` when Zen holds none. */
export function readXCookies(profileDir: string): XCookies | null {
	const cookies = join(profileDir, COOKIES);
	if (!existsSync(cookies)) return null;
	const rows = withSnapshot(cookies, db =>
		db
			.query<{ name: string; value: string }, []>(
				"SELECT name, value FROM moz_cookies WHERE host IN ('.x.com', 'x.com') AND name IN ('auth_token', 'ct0') ORDER BY lastAccessed",
			)
			.all(),
	);
	const newest = Object.fromEntries(rows.map(({ name, value }) => [name, value]));
	return newest.auth_token && newest.ct0 ? { authToken: newest.auth_token, ct0: newest.ct0 } : null;
}
