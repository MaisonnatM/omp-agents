import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "omp-agents-agent-"));
process.env.PI_CODING_AGENT_DIR = dir;
process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
process.env.CODEX_HOME = join(dir, "codex");
process.env.XDG_CONFIG_HOME = join(dir, "config");
// Run from an omp session, tests inherit its PI_SESSION_ID, and the session-trailer git hook would stamp it on every test commit.
delete process.env.PI_SESSION_ID;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
