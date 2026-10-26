/**
 * How the page proves it holds the access token, which `src/server/http.ts` checks and `web/api.ts` sends. The
 * token lives in the origin's localStorage, which no other port can read, never in a cookie, which every port of
 * the host is sent.
 */

/** Where the page keeps the access token, which the desktop window's preload stores from `pageAccess` in `src/server/auth.ts`. */
export const TOKEN_STORAGE_KEY = "omp-agents.token";

/** Where the page keeps the media key, which tags that load from `/api/` send as `?key=`, since they send no header. */
export const MEDIA_KEY_STORAGE_KEY = "omp-agents.media-key";

/** The query parameter that carries the media key. */
export const MEDIA_KEY_PARAM = "key";

/** The subprotocol the dashboard's sockets speak, which the server echoes; the token travels beside it, never echoed. */
export const SOCKET_PROTOCOL = "omp-agents";

/** A socket offers the token as the subprotocol `bearer.<token>`, since a browser's socket can send no header. */
export const SOCKET_TOKEN_PREFIX = "bearer.";
