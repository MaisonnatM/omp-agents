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
The route's `parse` slot reads the body with `parseEdit`, which checks only the edit's field types, and answers 400 with `EDIT_SHAPE` when they are wrong.
`editProjectMemory` refuses a `root` that is not one of those main checkouts, then checks the ops with `parseOps` and applies them all or nothing with `applyMemoryOps`, as the tool does.
The edit records session `DASHBOARD_SESSION`, `dashboard`, so its memories' source reads `#dashboard`.
It answers the whole view after the edit, or 400 with every reason the memory gave, joined by spaces.
The kinds, the slug, line, and body limits, the raw op, and the source tag live in `templates/omp/agent/extensions/project-memory/contract.ts`, which imports nothing, so the tool, the server, and the page share one copy.

## Glossary

`GET /api/glossary` answers a `GlossaryView`: the same main checkouts as the project memory, those with a `GLOSSARY.md` that defines at least one term, by folder name.
`glossaryView` in `src/glossary.ts` reads each file at every request, so the tab shows the file as it is on disk and keeps no copy.
`parseGlossary` splits the file into its `##` sections and their terms: a term starts at a line that opens with a bold name and a colon, `**Term**:` or a list item `- **Term**: definition`, and runs to the next blank line, term, or heading; its `_Avoid_:` line, split on commas, gives the words to avoid.
Terms above every heading sit in a section with title `null`; prose that is not a term is left out.

## Bookmarks

`GET /api/bookmarks` answers a `BookmarksView`: every bookmark newest first, whether Zen's profile was read, and the X sync's state.
Each bookmark has the shape of its source: a `ZenBookmark` holds a page's title, URL, and folder, and an `XBookmark` a post's author's name, `@handle`, text, and URL.
`Bookmarks` in `src/bookmarks/service.ts` serves both bookmark routes.
It reads Zen's bookmarks and its x.com sign-in again only when the database or its `-wal` file changed size or modification time, so a page that polls does not copy the databases at each read.

Zen's profile is the one its `profiles.ini` in `~/Library/Application Support/zen/` names as the install's default, else the profile marked default, found by `zenProfileDir` in `src/bookmarks/zen.ts` at each read.
Zen keeps its databases locked while it runs and holds recent rows in their write-ahead logs, so each read copies the database and its `-wal` file to a temp directory, opens the copy, and deletes it after.
`zenBookmarks` maps `moz_bookmarks` rows of type 1 joined to `moz_places`, with `dateAdded` in microseconds.
A bookmark's folder is the list of its parent folders from the root down, the roots named as Zen's menu names them, `Toolbar`, `Menu`, `Other`, and `Mobile`, so a toolbar folder is `["Toolbar", "Design"]`.
Bookmarks under the tags root are tags, not bookmarks, and a `place:` URL is a saved query; neither shows.

## The X sync

`POST /api/bookmarks/x-sync`, with a JSON body such as `{}`, reads the x.com bookmarks again and answers the `BookmarksView` after it.
A `GET` never syncs; the page asks for a sync.
A sync already under way is the one a second request waits on.

The sync has no X API key: it reads the `auth_token` and `ct0` cookies of the user's signed-in Zen session from `cookies.sqlite`, the newest of each, and sends them as x.com's own page does, with the public web bearer token and `x-csrf-token` set to `ct0`.
X renames its GraphQL queries with each release, so each sync finds the `Bookmarks` query first.
It reads `https://x.com/home`, whose chunk maps name each code chunk and its hash; `bookmarkChunks` in `src/bookmarks/x-sync.ts` builds the URL of each chunk whose name holds `Bookmarks`, and `bookmarksQueryIn` finds `queryId:"…",operationName:"Bookmarks"` there with its `featureSwitches` and `fieldToggles`.
Each feature takes the value the page's own feature configuration gives it, and `false` when the page gives none.
`fetchXBookmarks` then reads 100 posts a page, following the bottom cursor until a page adds no new post or `MAX_X_BOOKMARKS` (2000) are read.
`xBookmarksPage` maps each post to an `XBookmark`: its URL `https://x.com/<handle>/status/<id>`, its author's name, its text, the long text of a long post, `@handle`, `lang`, the language X detected, and `media`.
`media` holds the post's photos, videos, and GIFs from `legacy.extended_entities.media`, or `legacy.entities.media` when X sent no extended list: each one's image or poster on `pbs.twimg.com`, its size, its alt text, and a video's or GIF's MP4 of the highest bitrate on `video.twimg.com`.
The text drops the `t.co` link X ends it with when that link is a media item's `url`.
The page loads the images straight from X, so its Content Security Policy in `web/index.html` allows `https://pbs.twimg.com` in `img-src`.
X refuses `video.twimg.com` to a player whose page sends another site as `Referer`, and a `<video>` cannot drop it, so the player loads each MP4 through `GET /api/bookmarks/x-video?url=<MP4>`, in `src/bookmarks/x-video.ts`, which relays the player's `Range` to `video.twimg.com` only and answers X's bytes and range headers.
It takes the media key as `?key=` like the other media routes, and `media-src` stays `'self'`.
X does not say when a post was bookmarked, so `addedAt` is when it was posted, and the posts keep X's order, newest bookmark first, before the merge sorts them by that time.

`translatePosts` in `src/bookmarks/translate.ts` then gives each post in another language its English as `translation`.
A post whose `lang` is English, missing, or one of X's codes for no language (`und`, `zxx`, `qme`, `qam`, `qct`, `qht`, `qst`) keeps `null`.
A post the last sync translated keeps that translation while its text is the same; the others go, four at a time, to Google Translate's keyless web endpoint, `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=<text>`, whose first list's segments joined are the English.
So the text of each post not yet translated leaves the machine for Google at a sync, and never at a read.
A translation Google refuses, answers in another shape, or answers as the text was, as for a post X took for another language, stays `null` and never fails the sync; the next sync asks again.

`src/bookmarks/store.ts` keeps the last sync that succeeded, its time and its posts, as `synced`, and why the last one failed as `lastError`, in `bookmarks-x.json` in the data directory, written atomically.
A file in an older shape, or with a post missing a field, reads as never synced; a post kept before translations or media reads with `lang` and `translation` `null` and `media` empty until the next sync.
A failed sync keeps the posts of the last one that succeeded and records why in plain words: Zen holds no x.com sign-in, X refused the request, X limits how often bookmarks are read, X did not answer, or X changed its page.
The cookies are never logged or kept.
`XSyncState.signedIn` says whether Zen holds both cookies now.

## The `bookmarks` tool

Every session the dashboard starts loads `src/omp/bookmarks-extension.ts` through the module's `join`, with `--omp-agents-bookmarks-x-file` naming `bookmarks-x.json`; a packaged app ships it as `bookmarks-extension.js`.
Turning the module off in Settings › Modules drops the tool from new sessions.
The tool takes `query`, `source` (`zen` or `x`), and `limit` (default 20, at most 200), reads Zen's profile at each call and the X file as the last sync left it, and returns one line per bookmark, newest first: the day, `[zen]` or `[x]`, its folder or author, its title or text, and its URL.
`searchBookmarks` in `src/bookmarks/search.ts` keeps the bookmarks `bookmarkMatcher` in `src/shared/memory-page.ts` matches, the same match the page's search uses: every word of the query in a page's title, URL, or folders, or in a post's author's name, handle, text, or URL, ignoring case.
The tool says when Zen's profile is missing or the X bookmarks were never synced, so an agent does not read an empty answer as no bookmark.
