/** The Memory page's bookmarks: what `GET /api/bookmarks` answers, and the X sync, one at a time. See docs/architecture/memory-page.md. */
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteText } from "../fs";
import type { BookmarksView } from "../shared/memory-page";
import { mergeBookmarks, readXFile, type XFile } from "./store";
import { type Fetch, fetchXBookmarks, NOT_SIGNED_IN, XSyncError } from "./x-sync";
import { COOKIES, PLACES, readXCookies, readZenBookmarks } from "./zen";

/** What the Memory page's bookmarks read: Zen's profile directory, found when each read runs, the X file, and the network. */
export interface BookmarksEnv {
	profileDir: () => string | null;
	xFile: string;
	fetch: Fetch;
	now?: () => Date;
}

/** A read of one of a Zen profile's databases, done again only when the profile, the database, or its write-ahead log changed. */
class DatabaseRead<T> {
	#last: { stamp: string; value: T } | null = null;

	constructor(
		private readonly database: string,
		private readonly read: (profileDir: string) => T,
	) {}

	in(profileDir: string): T {
		const path = join(profileDir, this.database);
		const stamp = [path, `${path}-wal`]
			.map(file => {
				const stat = statSync(file, { throwIfNoEntry: false });
				return `${file}@${stat ? `${stat.mtimeMs}:${stat.size}` : "none"}`;
			})
			.join("\n");
		const last = this.#last?.stamp === stamp ? this.#last : { stamp, value: this.read(profileDir) };
		this.#last = last;
		return last.value;
	}
}

export class Bookmarks {
	#syncing: Promise<BookmarksView> | null = null;
	readonly #zen = new DatabaseRead(PLACES, readZenBookmarks);
	readonly #signedIn = new DatabaseRead(COOKIES, profileDir => readXCookies(profileDir) !== null);

	constructor(private readonly env: BookmarksEnv) {}

	view(): BookmarksView {
		const profile = this.env.profileDir();
		return this.#viewOf(profile, readXFile(this.env.xFile), profile !== null && this.#signedIn.in(profile));
	}

	#viewOf(profile: string | null, x: XFile, signedIn: boolean): BookmarksView {
		const { bookmarks, zenFound } = mergeBookmarks(profile === null ? null : this.#zen.in(profile), x);
		return { bookmarks, zenFound, x: { syncedAt: x.synced?.at ?? null, error: x.lastError, signedIn } };
	}

	/** Reads the x.com bookmarks again and keeps them, or keeps the last ones with why this sync failed; a sync already under way is the one answered. */
	syncX(): Promise<BookmarksView> {
		this.#syncing ??= this.#sync().finally(() => {
			this.#syncing = null;
		});
		return this.#syncing;
	}

	async #sync(): Promise<BookmarksView> {
		const profile = this.env.profileDir();
		const cookies = profile === null ? null : readXCookies(profile);
		let next: XFile;
		try {
			if (!cookies) throw new XSyncError(NOT_SIGNED_IN);
			const bookmarks = await fetchXBookmarks(this.env.fetch, cookies);
			next = { synced: { at: (this.env.now?.() ?? new Date()).toISOString(), bookmarks }, lastError: null };
		} catch (error) {
			if (!(error instanceof XSyncError)) throw error;
			next = { synced: readXFile(this.env.xFile).synced, lastError: error.message };
		}
		mkdirSync(dirname(this.env.xFile), { recursive: true });
		await atomicWriteText(this.env.xFile, `${JSON.stringify(next)}\n`);
		return this.#viewOf(profile, next, cookies !== null);
	}
}
