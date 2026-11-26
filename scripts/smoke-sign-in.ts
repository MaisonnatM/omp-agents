/**
 * Writes the script that signs a browser page in to a running dashboard, for `evaluate_script`'s `sourcePath` in the
 * chrome-devtools tools: it puts `pageAccess(token)` into the page's `localStorage` and reloads it. It prints only the
 * script's path, so the token and what derives from it never reach a transcript. `--token` defaults to the token file
 * that the server reads, which honors `XDG_CONFIG_HOME`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pageAccess } from "../src/server/auth";
import { scriptToken } from "./served";

const { values } = parseArgs({ options: { token: { type: "string" }, out: { type: "string" } } });
const path = resolve(values.out ?? join(import.meta.dir, "..", "tmp", "smoke", "sign-in.js"));
mkdirSync(dirname(path), { recursive: true });
const entries = JSON.stringify(pageAccess(scriptToken(values.token)));
// Only the user may read it: it holds the sign-in.
writeFileSync(path, `() => {\n\tfor (const [key, value] of Object.entries(${entries})) localStorage.setItem(key, value);\n\tlocation.reload();\n}\n`, { mode: 0o600 });
console.log(path);
