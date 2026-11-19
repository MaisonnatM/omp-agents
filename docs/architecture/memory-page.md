# Memory page

The Memory module, id `memory`, gathers what the user and the agents remember: omp memory, each workspace repository's project memory, and the user's bookmarks from Zen and x.com.
It keeps no state of its own: it has no `store`, and its page reads everything over its own routes.
Its shapes are in `src/shared/memory-page.ts`; its server half is `MEMORY_MODULE` in `src/memory-module.ts`, listed in [Modules](modules.md).
The omp memory tab reads `GET /api/omp-memory`, which Settings › omp memory also reads.

## Project memory

`GET /api/project-memory` answers a `ProjectMemoryView`.
The workspaces are those the page shows, `ModuleCore.workspaces` from the core: those sessions ran in and those Settings › Workspaces added, less the hidden ones.
`repositoriesOf` in `src/source-control.ts` turns them into main checkouts, each repository once, none in a temp directory.
`projectMemoryView` in `src/project-memory.ts` reads each repository's `refs/omp/memory` with the `project_memory` tool's own code, `readMemory` and `memoryTip` in `templates/omp/agent/extensions/project-memory/memory.ts`.
A repository's memories come newest `updated` first; the repositories with memories come first, then by folder name.

`PUT /api/project-memory` takes a `ProjectMemoryEdit`, `{ root, ops }`, the `project_memory` tool's ops.
`editProjectMemory` refuses a `root` that is not one of those main checkouts, then checks the ops with `parseOps` and applies them all or nothing with `applyMemoryOps`, as the tool does.
The edit records session `dashboard`, so its memories' source reads `#dashboard`.
It answers the whole view after the edit, or 400 with every reason the memory gave, joined by spaces.

## Bookmarks

`GET /api/bookmarks` answers a `BookmarksView`: every bookmark newest first, whether Zen's profile was read, and the X sync's state.
`Bookmarks` in `src/bookmarks.ts` serves both bookmark routes.

Zen's profile is the one its `profiles.ini` in `~/Library/Application Support/zen/` names as the install's default, else the profile marked default, found by `zenProfileDir` at each read.
Zen keeps its databases locked while it runs and holds recent rows in their write-ahead logs, so each read copies the database and its `-wal` file to a temp directory, opens the copy, and deletes it after.
`zenBookmarks` maps `moz_bookmarks` rows of type 1 joined to `moz_places`, with `dateAdded` in microseconds.
A bookmark's folder is its parent chain from the root down, the roots named as Zen's menu names them, `Toolbar`, `Menu`, `Other`, and `Mobile`, so a toolbar folder reads `Toolbar / Design`.
Bookmarks under the tags root are tags, not bookmarks, and a `place:` URL is a saved query; neither shows.

## The X sync

`POST /api/bookmarks/x-sync`, with a JSON body such as `{}`, reads the x.com bookmarks again and answers the `BookmarksView` after it.
A `GET` never syncs; the page asks for a sync.
A sync already under way is the one a second request waits on.

The sync has no X API key: it reads the `auth_token` and `ct0` cookies of the user's signed-in Zen session from `cookies.sqlite`, the newest of each, and sends them as x.com's own page does, with the public web bearer token and `x-csrf-token` set to `ct0`.
X renames its GraphQL queries with each release, so each sync finds the `Bookmarks` query first.
It reads `https://x.com/home`, whose chunk maps name each code chunk and its hash; `bookmarkChunks` builds the URL of each chunk whose name holds `Bookmarks`, and `bookmarksQueryIn` finds `queryId:"…",operationName:"Bookmarks"` there with its `featureSwitches` and `fieldToggles`.
Each feature takes the value the page's own feature configuration gives it, and `false` when the page gives none.
`fetchXBookmarks` then reads 100 posts a page, following the bottom cursor until a page adds no new post or `MAX_X_BOOKMARKS` (2000) are read.
`xBookmarksPage` maps each post to a `Bookmark`: its URL `https://x.com/<handle>/status/<id>`, its author's name as its title, its text, the long text of a long post, and `@handle`.
X does not say when a post was bookmarked, so `addedAt` is when it was posted, and the posts keep X's order, newest bookmark first, before the merge sorts them by that time.

The posts, the time of the last sync that succeeded, and why the last one failed are kept in `bookmarks-x.json` in the data directory, written atomically.
A failed sync keeps the posts of the last one that succeeded and records why in plain words: Zen holds no x.com sign-in, X refused the request, X limits how often bookmarks are read, X did not answer, or X changed its page.
The cookies are never logged or kept.
`XSyncState.signedIn` says whether Zen holds both cookies now.

## The `bookmarks` tool

Every session the dashboard starts loads `src/omp/bookmarks-extension.ts` through the module's `join`, with `--omp-agents-bookmarks-x-file` naming `bookmarks-x.json`; a packaged app ships it as `bookmarks-extension.js`.
Turning the module off in Settings › Modules drops the tool from new sessions.
The tool takes `query`, `source` (`zen` or `x`), and `limit` (default 20, at most 200), reads Zen's profile at each call and the X file as the last sync left it, and returns one line per bookmark, newest first: the day, `[zen]` or `[x]`, its folder or author, its title or text, and its URL.
`searchBookmarks` matches when every word of the query appears in a bookmark's title, URL, folder, text, or author, ignoring case.
The tool says when Zen's profile is missing or the X bookmarks were never synced, so an agent does not read an empty answer as no bookmark.
