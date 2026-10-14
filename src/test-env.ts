/**
 * Tests run against throwaway agent dirs, never the user's `~/.omp/agent`, `~/.claude`, or `~/.codex`. omp reads its
 * variable once, when it is imported, and the session formats read theirs at import too.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "omp-agents-agent-"));
process.env.PI_CODING_AGENT_DIR = dir;
// Left unmade, as on a machine without Claude Code or Codex.
process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
process.env.CODEX_HOME = join(dir, "codex");
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
