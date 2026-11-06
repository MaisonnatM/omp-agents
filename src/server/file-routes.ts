import { join, resolve } from "node:path";
import { gitCheckout } from "../git";
import { blobsDir } from "../omp/config";
import { directoryOf } from "../paths";
import { PROMPT_IMAGE_TYPES } from "../shared/sessions";
import { MEDIA_FILE_TYPES } from "../shared/transcript";
import { SystemLoadReader } from "../system-load";
import { findMediaFile, firstFile, readTextFile } from "../local-file";
import type { Terminals } from "../terminals";
import type { Worktrees } from "../worktrees";
import { MAX_WORKTREE_BATCH } from "../worktrees-shared";
import { answer, checked, fail } from "./http";
import { parseBranchRelease, parsePromptDocument, parseWorktreeRemoval, SHA256 } from "./wire";
import { MAX_PROMPT_DOCUMENT_BYTES } from "../shared/prompt-files";
import { documentText, UnreadableDocument } from "../omp/documents";
import type { RouteKit, Routes } from "./route-kit";
import { dirParam } from "./dir-param";

/** What the file routes read: the registered worktrees and the terminal panel's shells. */
export interface FileRoutesEnv {
	worktrees: Worktrees;
	terminals: Terminals;
	/** Where a relative path in session `sessionId`'s text may start, the most recently used first. */
	fileDirsOf(sessionId: string): string[];
}

/** Git checkouts and worktrees, the machine's load, the terminal panel's shells, prompt images and documents, and text files. */
export function fileRoutes({ get, media, write }: RouteKit, env: FileRoutesEnv): Routes {
	/**
	 * `GET /api/git?cwd=<dir>`: the git checkout of a directory, `null` outside one, for the new-session draft's branch
	 * picker and a session's header.
	 */
	const git = get(async (params) => {
		const cwd = await dirParam(params);
		return cwd instanceof Response ? cwd : answer(() => gitCheckout(cwd));
	});

	/** `GET /api/worktrees[?cwd=]`: every registered worktree of the repositories sessions ran in, or of the repository containing `cwd`. */
	const worktreeInventory = get((params) => answer(() => env.worktrees.inventory(params.get("cwd"))));

	/** `GET /api/worktrees/metrics?repository=&path=`: disk use, last commit, and change counts for one registered checkout. */
	const worktreeMetrics = get((params, req) => {
		const repository = params.get("repository");
		const path = params.get("path");
		if (!repository || !path) return fail(400, "Expected repository and path.");
		return answer(() => env.worktrees.metrics({ repository, path }, req.signal));
	});

	/** `PUT /api/worktrees/removal`: preview a removal, only of merged work when `merged` is set, or remove checkouts whose confirmation still matches. */
	const worktreeRemoval = write(
		(body) => checked(parseWorktreeRemoval(body), `Expected a preview with targets or removal with confirmed plans, up to ${MAX_WORKTREE_BATCH} worktrees.`),
		async (removal) =>
			removal.action === "preview"
				? { plans: await env.worktrees.previewAll(removal.targets, removal.merged) }
				: { results: await env.worktrees.remove(removal.plans, "Settings › Worktrees") },
	);

	/** `PUT /api/worktree/release` `{ cwd, branch }`: remove the linked worktree of `cwd`'s repository that has `branch` checked out, unless something keeps it. */
	const branchRelease = write(
		async (body) => {
			const release = checked(parseBranchRelease(body), "Expected { cwd, branch } with cwd an absolute directory");
			if (release instanceof Response) return release;
			const cwd = await directoryOf(release.cwd);
			return cwd ? { cwd, branch: release.branch } : fail(404, `${release.cwd.trim()} is not a directory.`);
		},
		({ cwd, branch }) => env.worktrees.releaseBranch(cwd, branch),
	);

	const systemLoad = new SystemLoadReader();
	/** `GET /api/system`: the CPU percent since the previous read, the memory available, and the disk space free, for the status bar. */
	const system = get(() => answer(() => systemLoad.read()));
	/** `GET /api/terminals`: the shells the terminal panel runs, oldest first, so a reloaded page reopens their tabs. */
	const terminals = get(() => Response.json(env.terminals.list()));

	/**
	 * `GET /api/image?hash=<sha256>&type=<image type>`: an image of a prompt that omp moved from its session file to its
	 * blob store, served as `type`, one of the prompt image types, since the store keeps no type.
	 */
	const image = media(async (params) => {
		const hash = params.get("hash") ?? "";
		const type = params.get("type") ?? "";
		if (!SHA256.test(hash) || !PROMPT_IMAGE_TYPES.includes(type)) return fail(400, "Expected ?hash= naming a blob and ?type= naming an image type");
		const file = Bun.file(join(blobsDir, hash));
		if (!(await file.exists())) return fail(404, `No image ${hash}`);
		// The address names the bytes, so they never change.
		return new Response(file, {
			headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
		});
	});

	/** `PUT /api/attachment/document`: `PromptDocument`, a file the composer attaches, as omp converts it; answers `{ text }`, or a 422 when omp cannot read it. */
	const promptDocument = write(
		(body) => checked(parsePromptDocument(body), `Expected { name, data } with a file of at most ${MAX_PROMPT_DOCUMENT_BYTES / 1024 / 1024} MB in base64`),
		async ({ name, data }) => ({ text: await documentText(name, Buffer.from(data, "base64")) }),
		(err) => (err instanceof UnreadableDocument ? fail(422, err.message) : null),
	);

	/**
	 * The path a file route reads: `?path=`, or when that holds no file and `?session=` and `?relative=` say a session's
	 * text named it relative, the first file `relative` names from a directory that session's bash calls ran in or `cd` into.
	 */
	const pathOf = (params: URLSearchParams): Promise<string> => {
		const path = params.get("path") ?? "";
		const session = params.get("session");
		const relative = params.get("relative");
		return session && relative ? firstFile([path, ...env.fileDirsOf(session).map(dir => resolve(dir, relative))]) : Promise.resolve(path);
	};

	/** `GET /api/file?path=<path>[&session=<id>&relative=<path as written>]`: a text file that agent text names, by an absolute or `~/` path, for the page's file dialog. */
	const textFile = get(async (params) => {
		const read = await readTextFile(await pathOf(params));
		return read.ok ? Response.json(read.file) : fail(read.status, read.error);
	});

	/**
	 * `GET /api/media?path=<path>[&session=<id>&relative=<path as written>]`: an image or video that agent text names, by an absolute or `~/` path, served as its
	 * extension's type; Bun answers a `Range` request with its part, so a video seeks. Its own sandbox policy keeps an
	 * SVG opened at this address from running script on the page's origin.
	 */
	const mediaFile = media(async (params) => {
		const found = await findMediaFile(await pathOf(params));
		if (!found.ok) return fail(found.status, found.error);
		return new Response(Bun.file(found.real), {
			headers: {
				"Content-Type": MEDIA_FILE_TYPES[found.extension]!,
				"Content-Security-Policy": "sandbox; default-src 'none'",
				"X-Content-Type-Options": "nosniff",
				// The file may change under the same path, so the browser asks again each time.
				"Cache-Control": "private, no-cache",
			},
		});
	});

	return {
		"/api/git": { GET: git },
		"/api/worktrees": { GET: worktreeInventory },
		"/api/worktrees/metrics": { GET: worktreeMetrics },
		"/api/worktrees/removal": { PUT: worktreeRemoval },
		"/api/worktree/release": { PUT: branchRelease },
		"/api/system": { GET: system },
		"/api/terminals": { GET: terminals },
		"/api/image": { GET: image },
		"/api/attachment/document": { PUT: promptDocument },
		"/api/file": { GET: textFile },
		"/api/media": { GET: mediaFile },
	};
}
