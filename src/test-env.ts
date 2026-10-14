import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "omp-agents-agent-"));
process.env.PI_CODING_AGENT_DIR = dir;
process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
process.env.CODEX_HOME = join(dir, "codex");
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
